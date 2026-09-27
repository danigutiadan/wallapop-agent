const TelegramNotifier = require('../../infrastructure/notifications/TelegramNotifier');
const Item = require('../../domain/models/Item');

class CheckNewItemsUseCase {
  constructor(scraper, database, localDatabase, notifier) {
    this.scraper = scraper;
    this.database = database;
    this.localDatabase = localDatabase;
    this.notifier = notifier;
    this.seenProductIds = new Set();
    this.isFirstRun = true;
    this.config = null;
  }

  async init() {
    console.log('🤖 [Agent] Loading configuration...');
    
    if (this.database.isFirebaseEnabled()) {
      console.log('🤖 [Agent] Firebase enabled: multi-user mode active.');
      const fbConfig = await this.database.getConfig();
      this.config = fbConfig || { check_interval_minutes: 5 };
    } else {
      this.config = await this.localDatabase.getConfig();
      if (!this.config) {
        console.error('🤖 [Agent] Configuration not found.');
        process.exit(1);
      }
      const seenArray = await this.localDatabase.getSeenProducts();
      this.seenProductIds = new Set(seenArray || []);
      console.log(`🤖 [Agent] Loaded ${this.seenProductIds.size} seen product IDs.`);
    }
  }

  async reloadConfig() {
    if (this.database.isFirebaseEnabled()) {
      const fbConfig = await this.database.getConfig();
      if (fbConfig) {
        this.config = fbConfig;
      }
    } else {
      const localConfig = await this.localDatabase.getConfig();
      if (localConfig) {
        this.config = localConfig;
      }
    }
  }

  getSearchCacheKey(search) {
    if (search.url) return search.url;
    return JSON.stringify({
      keywords: search.keywords || '',
      min_price: search.min_price,
      max_price: search.max_price,
      order_by: search.order_by || 'newest',
      condition: search.condition,
      category_ids: search.category_ids,
      object_type_id: search.object_type_id,
      latitude: search.latitude,
      longitude: search.longitude,
      distance_in_km: search.distance_in_km,
      extra_filters: search.extra_filters || null
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

    if (this.database.isFirebaseEnabled()) {
      const users = await this.database.getAllUsers();
      if (users.length === 0) {
        console.log('🤖 [Agent] No users found in Firebase. Falling back to legacy single-user mode.');
        await this.runLegacy(options);
      } else {
        await this.runMultiUser(users, options);
      }
    } else {
      await this.runLegacy(options);
    }
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
        const botToken = user.telegram?.bot_token || user.telegram?.botToken || (user.id === 'CoZSISpMSdMZZCUUlud7nmo7kS12' ? process.env.TELEGRAM_BOT_TOKEN : null);
        const chatId = user.telegram?.chat_id || user.telegram?.chatId || (user.id === 'CoZSISpMSdMZZCUUlud7nmo7kS12' ? process.env.TELEGRAM_CHAT_ID : null);
        const telegramEnabled = user.telegram?.enabled !== false;
        const notifier = new TelegramNotifier(botToken, chatId);

        // Load user's seen products
        const seenArray = await this.database.getUserSeenProducts(user.id);
        const seenSet = new Set(seenArray || []);
        console.log(`🤖 [Agent] Loaded ${seenSet.size} seen products for user ${userEmail}.`);

        let userDbUpdated = false;

        for (const search of enabledSearches) {
          const searchName = search.name || search.keywords || 'Sin nombre';
          console.log(`🤖 [Agent] Running search "${searchName}" for user ${userEmail}...`);

          try {
            const cacheKey = this.getSearchCacheKey(search);
            let items;
            if (scrapeCache.has(cacheKey)) {
              items = scrapeCache.get(cacheKey);
              console.log(`🤖 [Agent] [Cache] Using cached results for "${searchName}" (${items.length} items).`);
            } else {
              items = await this.scraper.scrape(search);
              scrapeCache.set(cacheKey, items);
              console.log(`🤖 [Agent] Found ${items.length} total items on page.`);
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
                    item.sellerStats = await this.scraper.getSellerStats(item.userId);
                  }
                  const evalResult = this.evaluateSellerStats(item.sellerStats, minReviews, minRating);
                  if (!evalResult.pass) {
                    console.log(`🤖 [Agent] ❌ Ítem descartado "${item.title}": ${evalResult.reason}`);
                    continue;
                  }
                }

                seenSet.add(item.id);
                userDbUpdated = true;

                if (dryRun) {
                  console.log(`🤖 [Agent] [DRY RUN] Would notify: "${item.title}"`);
                } else if (telegramEnabled && notifier.isConfigured()) {
                  console.log(`🤖 [Agent] New Listing detected! Sending alerts for "${item.title}"`);
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

  async runLegacy(options = {}) {
    const { dryRun = false } = options;
    console.log(`🤖 [Agent] Legacy single-user mode active.`);

    await this.reloadConfig();

    let dbUpdated = false;

    if (!this.config || !this.config.searches) {
      console.log('🤖 [Agent] No searches configured.');
      return;
    }

    try {
      for (const search of this.config.searches) {
        const searchName = search.name || search.keywords || 'Sin nombre';
        if (search.enabled === false) {
          console.log(`🤖 [Agent] Skipping disabled search "${searchName}".`);
          continue;
        }
        console.log(`🤖 [Agent] Running search for "${searchName}"...`);
        
        try {
          const items = await this.scraper.scrape(search);
          console.log(`🤖 [Agent] Found ${items.length} total items on page.`);
          
          const newItems = items.filter(item => !this.seenProductIds.has(item.id));
          console.log(`🤖 [Agent] ${newItems.length} items are new.`);
          
          if (newItems.length > 0) {
            const shouldNotify = !this.isFirstRun || this.seenProductIds.size > 0;
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
              this.seenProductIds.add(item.id);
              dbUpdated = true;

              if (shouldNotify) {
                if (hasMinReviews || hasMinRating) {
                  if (!item.sellerStats) {
                    item.sellerStats = await this.scraper.getSellerStats(item.userId);
                  }
                  const evalResult = this.evaluateSellerStats(item.sellerStats, minReviews, minRating);
                  if (!evalResult.pass) {
                    console.log(`🤖 [Agent] ❌ Ítem descartado "${item.title}": ${evalResult.reason}`);
                    continue;
                  }
                }

                console.log(`🤖 [Agent] New Listing detected! Sending alerts for "${item.title}"`);
                
                if (dryRun) {
                  console.log(`🤖 [Agent] [DRY RUN] Would notify: "${item.title}"`);
                  continue;
                }
                
                if (this.config.notifications?.telegram?.enabled) {
                  await this.notifier.sendNotification(item, searchName);
                }
              } else {
                console.log(`🤖 [Agent] First run: Registered existing item "${item.title}" silently.`);
              }
            }
          }
        } catch (error) {
          console.error(`🤖 [Agent] Error executing search "${searchName}":`, error.message);
        }
      }
    } finally {
      if (this.scraper && typeof this.scraper.close === 'function') {
        await this.scraper.close();
      }
    }
    
    if (dbUpdated) {
      const list = Array.from(this.seenProductIds);
      if (this.database.isFirebaseEnabled()) {
        await this.database.saveSeenProducts(list);
      } else {
        await this.localDatabase.saveSeenProducts(list);
      }
      console.log(`🤖 [Agent] Saved updated seen database. Total seen items: ${this.seenProductIds.size}`);
    }
    
    this.isFirstRun = false;
    console.log(`🤖 [Agent] Legacy check cycle complete.`);
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

    if (this.database.isFirebaseEnabled()) {
      const users = await this.database.getAllUsers();
      const targetUsers = users.filter(user => {
        const hasTelegram = user.id === 'CoZSISpMSdMZZCUUlud7nmo7kS12' || !!(user.telegram?.chat_id || user.telegram?.chatId);
        const enabled = user.telegram?.enabled !== false;
        return hasTelegram && enabled;
      });

      if (targetUsers.length === 0) {
        console.log('🤖 [Agent] No users with Telegram configured found.');
        return;
      }

      for (const user of targetUsers) {
        const botToken = user.telegram?.bot_token || user.telegram?.botToken || (user.id === 'CoZSISpMSdMZZCUUlud7nmo7kS12' ? process.env.TELEGRAM_BOT_TOKEN : null);
        const chatId = user.telegram?.chat_id || user.telegram?.chatId || (user.id === 'CoZSISpMSdMZZCUUlud7nmo7kS12' ? process.env.TELEGRAM_CHAT_ID : null);
        const notifier = new TelegramNotifier(botToken, chatId);
        if (notifier.isConfigured()) {
          console.log(`🤖 [Agent] Sending test notification to user ${user.email || user.id}...`);
          await notifier.sendNotification(dummyItem, 'Filtro Test');
        }
      }
    } else {
      if (this.config?.notifications?.telegram?.enabled) {
        await this.notifier.sendNotification(dummyItem, 'Filtro Test');
      }
    }
  }
}

module.exports = CheckNewItemsUseCase;
