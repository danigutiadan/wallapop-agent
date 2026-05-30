const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { scrapeWallapop } = require('./scraper');
const notifier = require('./notifier');

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
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`[Agent] Configuration file not found at ${CONFIG_PATH}. Please create it.`);
        process.exit(1);
    }
    try {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
        config = JSON.parse(fileContent);

        // Override with ENV variables if present
        if (config.notifications) {
            if (process.env.TELEGRAM_BOT_TOKEN && config.notifications.telegram) {
                config.notifications.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
            }
            if (process.env.TELEGRAM_CHAT_ID && config.notifications.telegram) {
                config.notifications.telegram.chat_id = process.env.TELEGRAM_CHAT_ID;
            }
            if (process.env.WHATSAPP_CHAT_ID && config.notifications.whatsapp) {
                config.notifications.whatsapp.chat_id = process.env.WHATSAPP_CHAT_ID;
            }
        }

        return config;
    } catch (e) {
        console.error('[Agent] Error parsing config.json:', e.message);
        process.exit(1);
    }
}

/**
 * Load seen products database.
 */
function loadSeenDatabase() {
    if (fs.existsSync(DATABASE_PATH)) {
        try {
            const data = fs.readFileSync(DATABASE_PATH, 'utf-8');
            const list = JSON.parse(data);
            seenProductIds = new Set(list);
            console.log(`[Agent] Loaded ${seenProductIds.size} seen product IDs from database.`);
        } catch (e) {
            console.error('[Agent] Error reading database, starting fresh seen list:', e.message);
            seenProductIds = new Set();
        }
    } else {
        seenProductIds = new Set();
        console.log('[Agent] Database file not found, starting fresh seen list.');
    }
}

/**
 * Save seen products database.
 */
function saveSeenDatabase() {
    try {
        const list = Array.from(seenProductIds);
        fs.writeFileSync(DATABASE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Agent] Failed to write database file:', e.message);
    }
}

/**
 * Main check cycle.
 */
async function runCheckCycle(options = {}) {
    const { dryRun = false, runOnce = false } = options;
    console.log(`\n[Agent] Starting check cycle at ${new Date().toLocaleString()}...`);
    
    let dbUpdated = false;

    for (const search of config.searches) {
        const searchName = search.name || search.keywords || 'Sin nombre';
        console.log(`[Agent] Running search for "${searchName}"...`);
        
        try {
            const items = await scrapeWallapop(search);
            console.log(`[Agent] Found ${items.length} total items on page.`);
            
            // Wallapop results are sorted based on the search query.
            // If we filter, let's identify which ones are new.
            const newItems = items.filter(item => !seenProductIds.has(item.id));
            console.log(`[Agent] ${newItems.length} items are new.`);
            
            if (newItems.length > 0) {
                // If it is the first run and the seen database was empty, we can choose to skip notifying
                // to avoid flooding the user with 40 alerts of old products.
                const shouldNotify = !isFirstRun || seenProductIds.size > 0;
                
                for (const item of newItems) {
                    // Mark as seen immediately
                    seenProductIds.add(item.id);
                    dbUpdated = true;

                    if (shouldNotify) {
                        console.log(`[Agent] New Listing detected! Sending alerts for "${item.title}" (${item.price.amount}€)`);
                        
                        if (dryRun) {
                            console.log(`[Agent] [DRY RUN] Would notify: "${item.title}" - Link: https://es.wallapop.com/item/${item.web_slug}`);
                            continue;
                        }
                        
                        // Send Telegram Notification
                        if (config.notifications.telegram?.enabled) {
                            await notifier.sendTelegramNotification(config.notifications.telegram, item, searchName);
                        }
                        
                        // Send WhatsApp Notification
                        if (config.notifications.whatsapp?.enabled) {
                            if (notifier.isWhatsAppReady()) {
                                await notifier.sendWhatsAppNotification(config.notifications.whatsapp, item, searchName);
                            } else {
                                console.warn('[Agent] WhatsApp notification skipped because client is not authenticated/ready.');
                            }
                        }
                    } else {
                        console.log(`[Agent] First run / initialization: Registered existing item "${item.title}" without sending notification.`);
                    }
                }
            }
        } catch (error) {
            console.error(`[Agent] Error executing search "${searchName}":`, error.message);
        }
    }
    
    if (dbUpdated) {
        saveSeenDatabase();
        console.log(`[Agent] Saved updated seen database. Total seen items: ${seenProductIds.size}`);
    } else {
        console.log('[Agent] No new items added to database.');
    }
    
    isFirstRun = false;
    console.log(`[Agent] Check cycle complete.`);
}

/**
 * Sends a test notification to verify setup.
 */
async function sendTestNotification() {
    console.log('[Agent] Sending test notifications...');
    const dummyItem = {
        title: 'Artículo de Prueba (Logitech G920)',
        description: 'Esto es una descripción de prueba para verificar que el sistema de notificaciones de tu Wallapop Agent funciona correctamente.',
        price: { amount: 150, currency: 'EUR' },
        location: { city: 'Madrid', region2: 'Madrid' },
        web_slug: 'articulo-de-prueba-12345678'
    };

    if (config.notifications.telegram?.enabled) {
        console.log('[Agent] Testing Telegram...');
        await notifier.sendTelegramNotification(config.notifications.telegram, dummyItem, 'Filtro Test');
    }

    if (config.notifications.whatsapp?.enabled) {
        console.log('[Agent] Testing WhatsApp (Waiting 5s to ensure client is ready)...');
        await new Promise(r => setTimeout(r, 5000));
        if (notifier.isWhatsAppReady()) {
            await notifier.sendWhatsAppNotification(config.notifications.whatsapp, dummyItem, 'Filtro Test');
        } else {
            console.error('[Agent] WhatsApp is not ready. Did you scan the QR code?');
        }
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

    loadConfig();
    loadSeenDatabase();
    
    // Initialize WhatsApp if enabled in config
    if (config.notifications.whatsapp?.enabled) {
        notifier.initWhatsApp();
        
        // Wait for WhatsApp to be ready if we are running once/testing
        if (runOnce || testNotify) {
            console.log('[Agent] Waiting up to 30s for WhatsApp authentication...');
            for (let i = 0; i < 30; i++) {
                if (notifier.isWhatsAppReady()) break;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    
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
    console.log(`[Agent] Scheduling check loop every ${config.check_interval_minutes} minutes (${intervalMs}ms).`);
    
    setInterval(async () => {
        await runCheckCycle({ dryRun });
    }, intervalMs);
}

main().catch(err => {
    console.error('[Agent] Fatal error:', err);
    process.exit(1);
});
