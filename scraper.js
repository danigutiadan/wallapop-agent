const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Aplicar el camuflaje militar
chromium.use(stealth);

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * Scrapes Wallapop search results using Playwright by intercepting the internal API JSON response.
 * @param {Object} searchConfig - The search configuration.
 * @param {string} [searchConfig.url] - The raw search URL.
 * @param {string} [searchConfig.keywords] - Keywords to search.
 * @param {number} [searchConfig.min_price] - Minimum price.
 * @param {number} [searchConfig.max_price] - Maximum price.
 * @param {string} [searchConfig.order_by] - Order (e.g., 'newest', 'price_low_to_high').
 * @param {number} [searchConfig.latitude] - Location latitude.
 * @param {number} [searchConfig.longitude] - Location longitude.
 * @param {number} [searchConfig.distance_in_km] - Distance radius.
 * @returns {Promise<Array>} List of items found.
 */
async function scrapeWallapop(searchConfig) {
    let targetUrl = '';
    
    if (searchConfig.url) {
        targetUrl = searchConfig.url;
    } else {
        const params = [];
        if (searchConfig.keywords) params.push(`keywords=${encodeURIComponent(searchConfig.keywords)}`);
        if (searchConfig.min_price !== undefined) params.push(`min_sale_price=${searchConfig.min_price}`);
        if (searchConfig.max_price !== undefined) params.push(`max_sale_price=${searchConfig.max_price}`);
        if (searchConfig.order_by) params.push(`order_by=${searchConfig.order_by}`);
        if (searchConfig.latitude !== undefined) params.push(`latitude=${searchConfig.latitude}`);
        if (searchConfig.longitude !== undefined) params.push(`longitude=${searchConfig.longitude}`);
        if (searchConfig.distance_in_km !== undefined) params.push(`distance_in_km=${searchConfig.distance_in_km}`);
        
        targetUrl = `https://es.wallapop.com/search?${params.join('&')}`;
    }

    console.log(`🕷️ [Scraper] Navigating to: ${targetUrl}`);
    
    // Anti-bot: Random delay between 2 and 12 seconds
    const delayMs = Math.floor(Math.random() * 10000) + 2000;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`🕷️ [Scraper] Anti-bot measures: Sleeping for ${delayMs}ms before launching browser...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    const browser = await chromium.launch({
        headless: true
    });
    
    const context = await browser.newContext({
        userAgent: randomUserAgent,
        viewport: { width: 1280 + Math.floor(Math.random() * 200), height: 800 + Math.floor(Math.random() * 100) },
        locale: 'es-ES',
        extraHTTPHeaders: {
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        }
    });
    
    const page = await context.newPage();
    let itemsMap = new Map();
    let apiInterceptionTimeout = null;
    let debounceTimer = null;
    let resolveSearch = null;
    
    // Promise to resolve when we successfully intercept and parse the organic search response
    const searchDataPromise = new Promise((resolve) => {
        resolveSearch = resolve;
        
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('api.wallapop.com/api/v3/search/section') || url.includes('/api/v3/search/section')) {
                try {
                    const text = await response.text();
                    const json = JSON.parse(text);
                    
                    const sectionType = json.data?.section?.type;
                    const sectionItems = json.data?.section?.items || [];
                    
                    // Acumulamos items orgánicos
                    if (sectionType === 'organic_search_results') {
                        console.log(`🕷️ [Scraper] Intercepted search chunk: itemsCount=${sectionItems.length}`);
                        sectionItems.forEach(item => itemsMap.set(item.id, item));
                        
                        // Reiniciamos el temporizador de debounce
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            console.log(`🕷️ [Scraper] Network idle (no more chunks). Resolving with ${itemsMap.size} items.`);
                            resolveSearch(true);
                        }, 2500); // Esperar 2.5s desde el último chunk recibido
                    }
                } catch (err) {
                    // Fail silently for other requests or malformed responses
                }
            }
        });
        
        // Safety timeout to resolve even if no API response is intercepted (so we don't hang forever)
        apiInterceptionTimeout = setTimeout(async () => {
            console.log(`🕷️ [Scraper] Warning: API interception timeout reached.`);
            try {
                const title = await page.title();
                const content = await page.content();
                console.log(`🕷️ [Scraper] Page Title at timeout: "${title}"`);
                
                const lowerContent = content.toLowerCase();
                if (lowerContent.includes('datadome') || lowerContent.includes('captcha') || lowerContent.includes('access denied') || title.includes('Attention Required')) {
                    console.log(`🕷️ [Scraper] 🚨 BLOCK DETECTED: Wallapop has blocked this request (Datadome / Captcha).`);
                } else if (title === '') {
                    console.log(`🕷️ [Scraper] 🚨 BLOCK DETECTED: Page is completely blank (possible IP ban).`);
                } else {
                    console.log(`🕷️ [Scraper] No obvious bot blocks detected in HTML. The page might be very slow or the API structure changed.`);
                }
            } catch (e) {
                console.log(`🕷️ [Scraper] Could not extract debug info from page: ${e.message}`);
            }
            resolveSearch(false);
        }, 45000); // Increased to 45 seconds for GitHub Actions runners
    });

    try {
        await page.goto(targetUrl, {
            waitUntil: 'load',
            timeout: 60000
        });
        
        // Wait for search response interception
        await searchDataPromise;
        
    } catch (error) {
        console.error(`🕷️ [Scraper] Error scraping URL ${targetUrl}:`, error.message);
    } finally {
        if (apiInterceptionTimeout) {
            clearTimeout(apiInterceptionTimeout);
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        await browser.close();
    }
    
    return Array.from(itemsMap.values());
}

module.exports = {
    scrapeWallapop
};
