const { chromium } = require('playwright');

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

    console.log(`[Scraper] Navigating to: ${targetUrl}`);
    
    const browser = await chromium.launch({
        headless: true
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'es-ES'
    });
    
    const page = await context.newPage();
    let items = [];
    let apiInterceptionTimeout = null;
    
    // Promise to resolve when we successfully intercept and parse the organic search response
    const searchDataPromise = new Promise((resolve) => {
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('api.wallapop.com/api/v3/search/section') || url.includes('/api/v3/search/section')) {
                try {
                    const text = await response.text();
                    const json = JSON.parse(text);
                    
                    // We look for organic search results
                    const sectionType = json.data?.section?.type;
                    const sectionItems = json.data?.section?.items || [];
                    
                    if (sectionItems.length > 0) {
                        console.log(`[Scraper] Intercepted search section: type="${sectionType}", itemsCount=${sectionItems.length}`);
                        items = sectionItems;
                        resolve(true);
                    }
                } catch (err) {
                    // Fail silently for other requests or malformed responses
                }
            }
        });
        
        // Safety timeout to resolve even if no API response is intercepted (so we don't hang forever)
        apiInterceptionTimeout = setTimeout(() => {
            console.log(`[Scraper] Warning: API interception timeout reached.`);
            resolve(false);
        }, 20000);
    });

    try {
        await page.goto(targetUrl, {
            waitUntil: 'load',
            timeout: 30000
        });
        
        // Wait for search response interception
        await searchDataPromise;
        
    } catch (error) {
        console.error(`[Scraper] Error scraping URL ${targetUrl}:`, error.message);
    } finally {
        if (apiInterceptionTimeout) {
            clearTimeout(apiInterceptionTimeout);
        }
        await browser.close();
    }
    
    return items;
}

module.exports = {
    scrapeWallapop
};
