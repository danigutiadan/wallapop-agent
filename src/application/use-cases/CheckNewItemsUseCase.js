const TelegramNotifier = require('../../infrastructure/notifications/TelegramNotifier');
const Item = require('../../domain/models/Item');

class CheckNewItemsUseCase {
  constructor(scraper, database) {
    this.scraper = scraper;
    this.database = database;
    this.checkIntervalMinutes = Number(process.env.CHECK_INTERVAL_MINUTES) || 5;
  }

  get config() {
    return { check_interval_minutes: this.checkIntervalMinutes };
  }

  async init() {
    console.log('🤖 [Agent] Initializing multi-user search agent...');
    
    if (!this.database.isFirebaseEnabled()) {
      console.error('🤖 [Agent] Firebase is not enabled. Multi-user mode requires Firebase.');
      process.exit(1);
    }
    
    console.log(`🤖 [Agent] Firebase enabled: multi-user mode active (interval: ${this.checkIntervalMinutes} min).`);
  }

  getSearchCacheKey(search) {
    return JSON.stringify({
      url: search.url || '',
      vinted_url: search.vinted_url || '',
      keywords: search.keywords || '',
      min_price: search.min_price,
      max_price: search.max_price,
      order_by: search.order_by || 'newest',
      condition: search.condition,
      category_id: search.category_id,
      category_ids: search.category_ids,
      subcategory_ids: search.subcategory_ids,
      object_type_id: search.object_type_id,
      latitude: search.latitude,
      longitude: search.longitude,
      distance_in_km: search.distance_in_km,
      extra_filters: search.extra_filters || null,
      wallapop_enabled: search.wallapop_enabled !== false,
      vinted_enabled: search.vinted_enabled !== false
    });
  }

  evaluateSellerStats(stats, minReviews, minRating) {
    let sellerReviews = null;
    let sellerRating = null;

    if (stats) {
      const counters = Array.isArray(stats.counters) ? stats.counters : (Array.isArray(stats.data?.counters) ? stats.data.counters : []);
      const reviewsCounter = counters.find(c => c && c.type === 'reviews');
      if (reviewsCounter && reviewsCounter.value !== undefined) {
        sellerReviews = Number(reviewsCounter.value);
      } else if (stats.reviews_count !== undefined) {
        sellerReviews = Number(stats.reviews_count);
      } else if (stats.data?.reviews_count !== undefined) {
        sellerReviews = Number(stats.data.reviews_count);
      }

      const ratingCounter = counters.find(c => c && (c.type === 'rating' || c.type === 'scoring'));
      if (ratingCounter && ratingCounter.value !== undefined) {
        sellerRating = Number(ratingCounter.value);
      } else if (stats.rating !== undefined) {
        sellerRating = Number(stats.rating);
      } else if (stats.scoring !== undefined) {
        sellerRating = Number(stats.scoring);
      } else if (stats.data?.rating !== undefined) {
        sellerRating = Number(stats.data.rating);
      }
    }

    if (minReviews !== null && !isNaN(minReviews) && (sellerReviews === null || isNaN(sellerReviews) || sellerReviews < minReviews)) {
      const reviewsText = sellerReviews !== null && !isNaN(sellerReviews) ? sellerReviews : 0;
      return { pass: false, reason: `Vendedor con ${reviewsText} valoraciones (mínimo requerido: ${minReviews})` };
    }

    if (minRating !== null && !isNaN(minRating) && (sellerRating === null || isNaN(sellerRating) || sellerRating < minRating)) {
      const ratingText = sellerRating !== null && !isNaN(sellerRating) ? sellerRating : 'sin valoración';
      return { pass: false, reason: `Vendedor con rating ${ratingText} (mínimo requerido: ${minRating})` };
    }

    return { pass: true };
  }

  async run(options = {}) {
    console.log(`\n🤖 [Agent] Starting check cycle at ${new Date().toLocaleString()}...`);

    if (!this.database.isFirebaseEnabled()) {
      console.error('🤖 [Agent] Firebase is not enabled. Multi-user mode requires Firebase.');
      return;
    }

    const users = await this.database.getAllUsers();
    if (users.length === 0) {
      console.log('🤖 [Agent] No users found in Firebase.');
      return;
    }

    await this.runMultiUser(users, options);
  }

  async runMultiUser(users, options = {}) {
    const { dryRun = false } = options;
    console.log(`🤖 [Agent] Multi-user mode: processing ${users.length} user(s)...`);

    const scrapeCache = new Map();

    try {
      for (const user of users) {
        const userEmail = user.email || user.id;
        const searches = user.searches || [];
        const enabledSearches = searches.filter(s => s && s.enabled !== false);

        if (enabledSearches.length === 0) {
          console.log(`🤖 [Agent] User ${userEmail} has no enabled searches. Skipping.`);
          continue;
        }

        console.log(`\n🤖 [Agent] User ${userEmail} (${user.id}): ${enabledSearches.length} enabled search(es).`);

        // Extract telegram config
        const botToken = user.telegram?.bot_token || user.telegram?.botToken || null;
        const chatId = user.telegram?.chat_id || user.telegram?.chatId || null;
        const telegramEnabled = user.telegram?.enabled !== false;
        const notifier = new TelegramNotifier(botToken, chatId);

        // Load user's seen products
        const seenArray = await this.database.getUserSeenProducts(user.id);
        const seenSet = new Set(seenArray || []);
        console.log(`🤖 [Agent] Loaded ${seenSet.size} seen products for user ${userEmail}.`);

        let userDbUpdated = false;

        for (const search of enabledSearches) {
          const searchName = search.name || search.keywords || 'Sin nombre';
          const wallapopEnabled = search.wallapop_enabled !== false;
          const vintedEnabled = search.vinted_enabled !== false;

          if (!wallapopEnabled && !vintedEnabled) {
            console.log(`🤖 [Agent] Skipping search "${searchName}": both Wallapop and Vinted are disabled.`);
            continue;
          }

          console.log(`🤖 [Agent] Running search "${searchName}" for user ${userEmail}... (Wallapop: ${wallapopEnabled ? 'ON' : 'OFF'}, Vinted: ${vintedEnabled ? 'ON' : 'OFF'})`);

          try {
            const cacheKey = this.getSearchCacheKey(search);
            let items;
            if (scrapeCache.has(cacheKey)) {
              items = scrapeCache.get(cacheKey);
              console.log(`🤖 [Agent] [Cache] Using cached results for "${searchName}" (${items.length} items).`);
            } else {
              items = await this.scraper.scrape(search);
              scrapeCache.set(cacheKey, items);
              console.log(`🤖 [Agent] Found ${items.length} total items across providers.`);
            }

            const newItems = items.filter(item => !seenSet.has(item.id));
            console.log(`🤖 [Agent] ${newItems.length} items are new.`);

            if (newItems.length > 0) {
              const minReviews = search.min_reviews !== undefined && search.min_reviews !== null && search.min_reviews !== ''
                ? Number(search.min_reviews)
                : (search.min_seller_reviews !== undefined && search.min_seller_reviews !== null && search.min_seller_reviews !== ''
                    ? Number(search.min_seller_reviews)
                    : null);
              const minRating = search.min_seller_rating !== undefined && search.min_seller_rating !== null && search.min_seller_rating !== ''
                ? Number(search.min_seller_rating)
                : null;
              const hasMinReviews = minReviews !== null && !isNaN(minReviews);
              const hasMinRating = minRating !== null && !isNaN(minRating);

              for (const item of newItems) {
                if (hasMinReviews || hasMinRating) {
                  if (!item.sellerStats) {
                    item.sellerStats = await this.scraper.getSellerStats(item.userId, item.provider);
                  }
                  if (item.sellerStats && item.provider === 'vinted' && (item.sellerStats.city || item.sellerStats.country)) {
                    item.location = {
                      city: item.sellerStats.city || 'Vinted',
                      region2: item.sellerStats.country || 'Europa'
                    };
                  }
                  const evalResult = this.evaluateSellerStats(item.sellerStats, minReviews, minRating);
                  if (!evalResult.pass) {
                    console.log(`🤖 [Agent] ❌ Ítem descartado [${item.providerName}] "${item.title}": ${evalResult.reason}`);
                    continue;
                  }
                }

                seenSet.add(item.id);
                userDbUpdated = true;

                if (dryRun) {
                  console.log(`🤖 [Agent] [DRY RUN] Would notify [${item.providerName}]: "${item.title}"`);
                } else if (telegramEnabled && notifier.isConfigured()) {
                  console.log(`🤖 [Agent] New Listing detected on ${item.providerName}! Sending alerts for "${item.title}"`);
                  await notifier.sendNotification(item, searchName);
                }
              }
            }
          } catch (error) {
            console.error(`🤖 [Agent] Error executing search "${searchName}" for user ${userEmail}:`, error.message);
          }
        }

        if (userDbUpdated) {
          await this.database.saveUserSeenProducts(user.id, Array.from(seenSet));
          console.log(`🤖 [Agent] Saved updated seen database for user ${userEmail}. Total seen items: ${seenSet.size}`);
        }
      }
    } finally {
      if (this.scraper && typeof this.scraper.close === 'function') {
        await this.scraper.close();
      }
    }

    console.log(`🤖 [Agent] Multi-user check cycle complete.`);
  }

  async sendTestNotification() {
    console.log('🤖 [Agent] Sending test notification...');
    const dummyItem = new Item({
      id: 'test_123',
      title: 'Artículo de Prueba (Logitech G920)',
      description: 'Esto es una descripción de prueba.',
      price: { amount: 150, currency: 'EUR' },
      location: { city: 'Madrid', region2: 'Madrid' },
      web_slug: 'articulo-de-prueba-12345678'
    });

    if (!this.database.isFirebaseEnabled()) {
      console.error('🤖 [Agent] Firebase is not enabled. Cannot fetch users for test notification.');
      return;
    }

    const users = await this.database.getAllUsers();
    const targetUsers = users.filter(user => {
      const hasTelegram = !!(user.telegram?.chat_id || user.telegram?.chatId) && !!(user.telegram?.bot_token || user.telegram?.botToken);
      const enabled = user.telegram?.enabled !== false;
      return hasTelegram && enabled;
    });

    if (targetUsers.length === 0) {
      console.log('🤖 [Agent] No users with Telegram configured found.');
      return;
    }

    for (const user of targetUsers) {
      const botToken = user.telegram?.bot_token || user.telegram?.botToken || null;
      const chatId = user.telegram?.chat_id || user.telegram?.chatId || null;
      const notifier = new TelegramNotifier(botToken, chatId);
      if (notifier.isConfigured()) {
        console.log(`🤖 [Agent] Sending test notification to user ${user.email || user.id}...`);
        await notifier.sendNotification(dummyItem, 'Filtro Test');
      }
    }
  }
}

module.exports = CheckNewItemsUseCase;
