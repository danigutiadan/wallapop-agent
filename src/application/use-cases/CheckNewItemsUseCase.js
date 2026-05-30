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

  async run(options = {}) {
    const { dryRun = false } = options;
    console.log(`\n🤖 [Agent] Starting check cycle at ${new Date().toLocaleString()}...`);
    
    let dbUpdated = false;

    if (!this.config || !this.config.searches) {
      console.log('🤖 [Agent] No searches configured.');
      return;
    }

    for (const search of this.config.searches) {
      const searchName = search.name || search.keywords || 'Sin nombre';
      console.log(`🤖 [Agent] Running search for "${searchName}"...`);
      
      try {
        const items = await this.scraper.scrape(search);
        console.log(`🤖 [Agent] Found ${items.length} total items on page.`);
        
        const newItems = items.filter(item => !this.seenProductIds.has(item.id));
        console.log(`🤖 [Agent] ${newItems.length} items are new.`);
        
        if (newItems.length > 0) {
          const shouldNotify = !this.isFirstRun || this.seenProductIds.size > 0;
          
          for (const item of newItems) {
            this.seenProductIds.add(item.id);
            dbUpdated = true;

            if (shouldNotify) {
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
