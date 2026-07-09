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
      const fbConfig = await this.database.getConfig();
      if (fbConfig) {
        this.config = fbConfig;
      } else {
        const localConfig = await this.localDatabase.getConfig();
        if (localConfig) {
          this.config = localConfig;
          await this.database.saveConfig(localConfig);
          console.log('🤖 [Agent] Migrated local config to Firebase.');
        }
      }
    } else {
      this.config = await this.localDatabase.getConfig();
    }

    if (!this.config) {
      console.error('🤖 [Agent] Configuration not found.');
      process.exit(1);
    }

    // Load seen database
    let seenArray = [];
    if (this.database.isFirebaseEnabled()) {
      seenArray = await this.database.getSeenProducts();
      if (!seenArray || seenArray.length === 0) {
        seenArray = await this.localDatabase.getSeenProducts();
        if (seenArray && seenArray.length > 0) {
          await this.database.saveSeenProducts(seenArray);
        }
      }
    } else {
      seenArray = await this.localDatabase.getSeenProducts();
    }
    
    this.seenProductIds = new Set(seenArray || []);
    console.log(`🤖 [Agent] Loaded ${this.seenProductIds.size} seen product IDs.`);
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

  async run(options = {}) {
    const { dryRun = false } = options;
    console.log(`\n🤖 [Agent] Starting check cycle at ${new Date().toLocaleString()}...`);
    
    await this.reloadConfig();

    let dbUpdated = false;

    if (!this.config || !this.config.searches) {
      console.log('🤖 [Agent] No searches configured.');
      return;
    }

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
                const stats = await this.scraper.getSellerStats(item.userId);
                item.sellerStats = stats;

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

                if (hasMinReviews && (sellerReviews === null || isNaN(sellerReviews) || sellerReviews < minReviews)) {
                  const reviewsText = sellerReviews !== null && !isNaN(sellerReviews) ? sellerReviews : 0;
                  console.log(`🤖 [Agent] ❌ Ítem descartado "${item.title}": Vendedor con ${reviewsText} valoraciones (mínimo requerido: ${minReviews})`);
                  continue;
                }

                if (hasMinRating && (sellerRating === null || isNaN(sellerRating) || sellerRating < minRating)) {
                  const ratingText = sellerRating !== null && !isNaN(sellerRating) ? sellerRating : 'sin valoración';
                  console.log(`🤖 [Agent] ❌ Ítem descartado "${item.title}": Vendedor con rating ${ratingText} (mínimo requerido: ${minRating})`);
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

    if (this.scraper && typeof this.scraper.close === 'function') {
      await this.scraper.close();
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
    console.log(`🤖 [Agent] Check cycle complete.`);
  }

  async sendTestNotification() {
    console.log('🤖 [Agent] Sending test notification...');
    const Item = require('../../domain/models/Item');
    const dummyItem = new Item({
      id: 'test_123',
      title: 'Artículo de Prueba (Logitech G920)',
      description: 'Esto es una descripción de prueba.',
      price: { amount: 150, currency: 'EUR' },
      location: { city: 'Madrid', region2: 'Madrid' },
      web_slug: 'articulo-de-prueba-12345678'
    });

    if (this.config?.notifications?.telegram?.enabled) {
      await this.notifier.sendNotification(dummyItem, 'Filtro Test');
    }
  }
}

module.exports = CheckNewItemsUseCase;
