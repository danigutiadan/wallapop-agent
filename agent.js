const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { scrapeWallapop } = require('./scraper');
const notifier = require('./notifier');
const firebase = require('./firebase');

// Paths
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATABASE_PATH = path.join(__dirname, 'seen_products.json');

// Global state
let config = {};
let seenProductIds = new Set();
let isFirstRun = true;

/**
 * Load configuration file.
 */
async function loadConfig() {
    if (firebase.isFirebaseEnabled()) {
        console.log('🤖 [Agent] Attempting to load config from Firebase...');
        const remoteConfig = await firebase.getRemoteConfig();
        if (remoteConfig) {
            config = remoteConfig;
            console.log('🤖 [Agent] Loaded configuration from Firebase.');
        } else {
            console.log('🤖 [Agent] No config found in Firebase. Checking local file to migrate...');
            if (fs.existsSync(CONFIG_PATH)) {
                const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
                config = JSON.parse(fileContent);
                await firebase.saveRemoteConfig(config);
                console.log('🤖 [Agent] Migrated local config to Firebase.');
            } else {
                console.error(`🤖 [Agent] Configuration file not found.`);
                process.exit(1);
            }
        }
    } else {
        if (!fs.existsSync(CONFIG_PATH)) {
            console.error(`🤖 [Agent] Configuration file not found at ${CONFIG_PATH}. Please create it.`);
            process.exit(1);
        }
        try {
            const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
            config = JSON.parse(fileContent);
        } catch (e) {
            console.error('🤖 [Agent] Error parsing config.json:', e.message);
            process.exit(1);
        }
    }

    // Override with ENV variables if present
    if (config.notifications) {
        if (process.env.TELEGRAM_BOT_TOKEN && config.notifications.telegram) {
            config.notifications.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
        }
        if (process.env.TELEGRAM_CHAT_ID && config.notifications.telegram) {
            config.notifications.telegram.chat_id = process.env.TELEGRAM_CHAT_ID;
        }
    }

    return config;
}

/**
 * Load seen products database.
 */
async function loadSeenDatabase() {
    if (firebase.isFirebaseEnabled()) {
        console.log('🤖 [Agent] Attempting to load seen products from Firebase...');
        const remoteSeen = await firebase.getRemoteSeenProducts();
        if (remoteSeen && remoteSeen.length > 0) {
            seenProductIds = new Set(remoteSeen);
            console.log(`🤖 [Agent] Loaded ${seenProductIds.size} seen product IDs from Firebase.`);
            return;
        } else {
            console.log('🤖 [Agent] No seen products in Firebase, checking local migration...');
        }
    }

    if (fs.existsSync(DATABASE_PATH)) {
        try {
            const data = fs.readFileSync(DATABASE_PATH, 'utf-8');
            const list = JSON.parse(data);
            seenProductIds = new Set(list);
            console.log(`🤖 [Agent] Loaded ${seenProductIds.size} seen product IDs from local database.`);
            
            // Migrate to Firebase if enabled
            if (firebase.isFirebaseEnabled()) {
                await firebase.saveRemoteSeenProducts(list);
                console.log('🤖 [Agent] Migrated local seen products to Firebase.');
            }
        } catch (e) {
            console.error('🤖 [Agent] Error reading database, starting fresh seen list:', e.message);
            seenProductIds = new Set();
        }
    } else {
        seenProductIds = new Set();
        console.log('🤖 [Agent] Database file not found, starting fresh seen list.');
    }
}

/**
 * Save seen products database.
 */
async function saveSeenDatabase() {
    const list = Array.from(seenProductIds);
    if (firebase.isFirebaseEnabled()) {
        const ok = await firebase.saveRemoteSeenProducts(list);
        if (!ok) {
            console.error('🤖 [Agent] Failed to write database to Firebase.');
        }
    } else {
        try {
            fs.writeFileSync(DATABASE_PATH, JSON.stringify(list, null, 2), 'utf-8');
        } catch (e) {
            console.error('🤖 [Agent] Failed to write database file:', e.message);
        }
    }
}

/**
 * Main check cycle.
 */
async function runCheckCycle(options = {}) {
    const { dryRun = false, runOnce = false } = options;
    console.log(`\n🤖 [Agent] Starting check cycle at ${new Date().toLocaleString()}...`);
    
    let dbUpdated = false;

    for (const search of config.searches) {
        const searchName = search.name || search.keywords || 'Sin nombre';
        console.log(`🤖 [Agent] Running search for "${searchName}"...`);
        
        try {
            const items = await scrapeWallapop(search);
            console.log(`🤖 [Agent] Found ${items.length} total items on page.`);
            
            // Wallapop results are sorted based on the search query.
            // If we filter, let's identify which ones are new.
            const newItems = items.filter(item => !seenProductIds.has(item.id));
            console.log(`🤖 [Agent] ${newItems.length} items are new.`);
            
            if (newItems.length > 0) {
                // If it is the first run and the seen database was empty, we can choose to skip notifying
                // to avoid flooding the user with 40 alerts of old products.
                const shouldNotify = !isFirstRun || seenProductIds.size > 0;
                
                for (const item of newItems) {
                    // Mark as seen immediately
                    seenProductIds.add(item.id);
                    dbUpdated = true;

                    if (shouldNotify) {
                        console.log(`🤖 [Agent] New Listing detected! Sending alerts for "${item.title}" (${item.price.amount}€)`);
                        
                        if (dryRun) {
                            console.log(`🤖 [Agent] [DRY RUN] Would notify: "${item.title}" - Link: https://es.wallapop.com/item/${item.web_slug}`);
                            continue;
                        }
                        
                        // Send Telegram Notification
                        if (config.notifications.telegram?.enabled) {
                            await notifier.sendTelegramNotification(config.notifications.telegram, item, searchName);
                        }
                    } else {
                        console.log(`🤖 [Agent] First run / initialization: Registered existing item "${item.title}" without sending notification.`);
                    }
                }
            }
        } catch (error) {
            console.error(`🤖 [Agent] Error executing search "${searchName}":`, error.message);
        }
    }
    
    if (dbUpdated) {
        await saveSeenDatabase();
        console.log(`🤖 [Agent] Saved updated seen database. Total seen items: ${seenProductIds.size}`);
    } else {
        console.log('🤖 [Agent] No new items added to database.');
    }
    
    isFirstRun = false;
    console.log(`🤖 [Agent] Check cycle complete.`);
}

/**
 * Sends a test notification to verify setup.
 */
async function sendTestNotification() {
    console.log('🤖 [Agent] Sending test notifications...');
    const dummyItem = {
        title: 'Artículo de Prueba (Logitech G920)',
        description: 'Esto es una descripción de prueba para verificar que el sistema de notificaciones de tu Wallapop Agent funciona correctamente.',
        price: { amount: 150, currency: 'EUR' },
        location: { city: 'Madrid', region2: 'Madrid' },
        web_slug: 'articulo-de-prueba-12345678'
    };

    if (config.notifications.telegram?.enabled) {
        console.log('🤖 [Agent] Testing Telegram...');
        await notifier.sendTelegramNotification(config.notifications.telegram, dummyItem, 'Filtro Test');
    }
}

/**
 * Entrypoint.
 */
async function main() {
    // Parse arguments
    const args = process.argv.slice(2);
    const runOnce = args.includes('--run-once');
    const dryRun = args.includes('--dry-run');
    const testNotify = args.includes('--test-notify');
    
    console.log('========================================');
    console.log('      WALLAPOP SEARCH AGENT & NOTIFIER   ');
    console.log('========================================');

    await loadConfig();
    await loadSeenDatabase();
    
    if (testNotify) {
        await sendTestNotification();
        process.exit(0);
    }
    
    if (runOnce) {
        await runCheckCycle({ dryRun, runOnce: true });
        process.exit(0);
    }
    
    // Run initial check
    await runCheckCycle({ dryRun });
    
    // Setup interval loop
    const intervalMs = (config.check_interval_minutes || 5) * 60 * 1000;
    console.log(`🤖 [Agent] Scheduling check loop every ${config.check_interval_minutes} minutes (${intervalMs}ms).`);
    
    setInterval(async () => {
        await runCheckCycle({ dryRun });
    }, intervalMs);
}

main().catch(err => {
    console.error('🤖 [Agent] Fatal error:', err);
    process.exit(1);
});
