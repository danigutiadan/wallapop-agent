const fs = require('fs');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode-terminal');

let whatsappClient = null;
let whatsappReady = false;

/**
 * Traverses Playwright caches to find the Chromium executable dynamically on Mac.
 * This allows whatsapp-web.js to use the browser that is already downloaded.
 */
function getChromiumExecutablePath() {
    const home = os.homedir();
    const cacheDir = path.join(home, 'Library/Caches/ms-playwright');
    if (fs.existsSync(cacheDir)) {
        try {
            const dirs = fs.readdirSync(cacheDir);
            const chromiumDirs = dirs.filter(d => d.startsWith('chromium-')).sort();
            if (chromiumDirs.length > 0) {
                const latestChromium = chromiumDirs[chromiumDirs.length - 1];
                const execPath = path.join(
                    cacheDir,
                    latestChromium,
                    'chrome-mac-arm64',
                    'Google Chrome for Testing.app',
                    'Contents',
                    'MacOS',
                    'Google Chrome for Testing'
                );
                if (fs.existsSync(execPath)) {
                    console.log(`[Notifier] Found Playwright Chromium executable at: ${execPath}`);
                    return execPath;
                }
            }
        } catch (e) {
            console.error('[Notifier] Error locating Playwright Chromium:', e.message);
        }
    }
    return null;
}

/**
 * Initializes the WhatsApp Web client.
 */
function initWhatsApp() {
    try {
        const { Client, LocalAuth } = require('whatsapp-web.js');
        const execPath = getChromiumExecutablePath();
        
        const clientOptions = {
            authStrategy: new LocalAuth({
                dataPath: path.join(__dirname, '.wwebjs_auth')
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        };

        if (execPath) {
            clientOptions.puppeteer.executablePath = execPath;
        }

        console.log('[Notifier] Initializing WhatsApp Web Client...');
        whatsappClient = new Client(clientOptions);

        whatsappClient.on('qr', (qr) => {
            console.log('[Notifier] WhatsApp QR Code received. Scan it with your phone:');
            qrcode.generate(qr, { small: true });
        });

        whatsappClient.on('ready', () => {
            console.log('[Notifier] WhatsApp Web Client is ready!');
            whatsappReady = true;
        });

        whatsappClient.on('auth_failure', (msg) => {
            console.error('[Notifier] WhatsApp authentication failure:', msg);
        });

        whatsappClient.on('disconnected', (reason) => {
            console.log('[Notifier] WhatsApp client disconnected:', reason);
            whatsappReady = false;
        });

        whatsappClient.initialize();
    } catch (err) {
        console.error('[Notifier] Failed to load whatsapp-web.js library:', err.message);
    }
}

/**
 * Format a description by trimming it to a set length and cleaning up double newlines.
 */
function formatDescription(desc, limit = 200) {
    if (!desc) return 'Sin descripción.';
    let clean = desc.trim();
    if (clean.length > limit) {
        clean = clean.substring(0, limit) + '...';
    }
    return clean;
}

/**
 * Send a notification via Telegram.
 */
async function sendTelegramNotification(telegramConfig, item, searchName) {
    if (!telegramConfig.bot_token || !telegramConfig.chat_id) {
        console.error('[Notifier] Telegram is enabled but bot_token or chat_id is missing.');
        return false;
    }

    const priceText = `${item.price.amount} ${item.price.currency === 'EUR' ? '€' : item.price.currency}`;
    const locationText = item.location ? `${item.location.city} (${item.location.region2 || item.location.region})` : 'No disponible';
    const cleanDesc = formatDescription(item.description, 250);
    const itemUrl = `https://es.wallapop.com/item/${item.web_slug}`;

    const text = `<b>🔔 ¡Nuevo producto en Wallapop!</b>\n` +
                 `<b>Filtro:</b> ${searchName}\n\n` +
                 `<b>Título:</b> ${item.title}\n` +
                 `<b>Precio:</b> ${priceText}\n` +
                 `<b>Ubicación:</b> ${locationText}\n\n` +
                 `<b>Descripción:</b>\n<i>${cleanDesc}</i>\n\n` +
                 `🔗 <a href="${itemUrl}">Ver producto en Wallapop</a>`;

    const telegramUrl = `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`;

    try {
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: telegramConfig.chat_id,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: false
            })
        });

        const json = await response.json();
        if (json.ok) {
            console.log(`[Notifier] Telegram notification sent for item: "${item.title}"`);
            return true;
        } else {
            console.error('[Notifier] Telegram API returned error:', json);
            return false;
        }
    } catch (error) {
        console.error('[Notifier] Error sending Telegram notification:', error.message);
        return false;
    }
}

/**
 * Send a notification via WhatsApp.
 */
async function sendWhatsAppNotification(whatsappConfig, item, searchName) {
    if (!whatsappReady || !whatsappClient) {
        console.warn('[Notifier] WhatsApp notification requested but client is not ready.');
        return false;
    }

    if (!whatsappConfig.chat_id) {
        console.error('[Notifier] WhatsApp is enabled but chat_id (phone number) is missing.');
        return false;
    }

    const priceText = `${item.price.amount} ${item.price.currency === 'EUR' ? '€' : item.price.currency}`;
    const locationText = item.location ? `${item.location.city} (${item.location.region2 || item.location.region})` : 'No disponible';
    const cleanDesc = formatDescription(item.description, 250);
    const itemUrl = `https://es.wallapop.com/item/${item.web_slug}`;

    const text = `🔔 *¡Nuevo producto en Wallapop!*\n` +
                 `*Filtro:* ${searchName}\n\n` +
                 `*Título:* ${item.title}\n` +
                 `*Precio:* ${priceText}\n` +
                 `*Ubicación:* ${locationText}\n\n` +
                 `*Descripción:*\n_${cleanDesc}_\n\n` +
                 `*Enlace:* ${itemUrl}`;

    // Format phone number to WhatsApp ID format (e.g. 34123456789@c.us for Spain number)
    let formattedChatId = whatsappConfig.chat_id;
    if (!formattedChatId.endsWith('@c.us') && !formattedChatId.endsWith('@g.us')) {
        // Strip any spaces, hyphens or plus signs
        const cleaned = formattedChatId.replace(/[\s\-\+]/g, '');
        formattedChatId = `${cleaned}@c.us`;
    }

    try {
        await whatsappClient.sendMessage(formattedChatId, text);
        console.log(`[Notifier] WhatsApp notification sent to ${formattedChatId} for item: "${item.title}"`);
        return true;
    } catch (error) {
        console.error('[Notifier] Error sending WhatsApp notification:', error.message);
        return false;
    }
}

module.exports = {
    initWhatsApp,
    sendTelegramNotification,
    sendWhatsAppNotification,
    isWhatsAppReady: () => whatsappReady
};
