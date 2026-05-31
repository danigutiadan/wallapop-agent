const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const Item = require('../../domain/models/Item');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class PlaywrightScraper {
  async scrape(searchConfig) {
    let targetUrl = '';
    
    if (searchConfig.url) {
        targetUrl = searchConfig.url;
    } else {
        const params = [];
        if (searchConfig.keywords) params.push(`keywords=${encodeURIComponent(searchConfig.keywords)}`);
        if (searchConfig.min_price !== undefined) params.push(`min_sale_price=${searchConfig.min_price}`);
        if (searchConfig.max_price !== undefined) params.push(`max_sale_price=${searchConfig.max_price}`);
        params.push(`order_by=${searchConfig.order_by || 'newest'}`);
        if (searchConfig.latitude !== undefined) params.push(`latitude=${searchConfig.latitude}`);
        if (searchConfig.longitude !== undefined) params.push(`longitude=${searchConfig.longitude}`);
        if (searchConfig.distance_in_km !== undefined) params.push(`distance_in_km=${searchConfig.distance_in_km}`);
        if (searchConfig.condition) params.push(`condition=${searchConfig.condition}`);
        if (searchConfig.category_ids) params.push(`category_ids=${searchConfig.category_ids}`);
        if (searchConfig.object_type_id) params.push(`object_type_id=${searchConfig.object_type_id}`);
        
        if (searchConfig.extra_filters && typeof searchConfig.extra_filters === 'object') {
            for (const [key, value] of Object.entries(searchConfig.extra_filters)) {
                if (value !== undefined && value !== null && value !== '') {
                    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
                }
            }
        }
        
        targetUrl = `https://es.wallapop.com/search?${params.join('&')}`;
    }

    console.log(`🕷️ [Scraper] Navigating to: ${targetUrl}`);
    
    const delayMs = Math.floor(Math.random() * 10000) + 2000;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`🕷️ [Scraper] Anti-bot measures: Sleeping for ${delayMs}ms before launching browser...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    const browser = await chromium.launch({ headless: true });
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
                    
                    if (sectionType === 'organic_search_results') {
                        console.log(`🕷️ [Scraper] Intercepted search chunk: itemsCount=${sectionItems.length}`);
                        sectionItems.forEach(rawItem => {
                            itemsMap.set(rawItem.id, new Item({
                              id: rawItem.id,
                              title: rawItem.title,
                              description: rawItem.description,
                              price: rawItem.price,
                              location: rawItem.location,
                              web_slug: rawItem.web_slug,
                              images: rawItem.images,
                              originalData: rawItem
                            }));
                        });
                        
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            console.log(`🕷️ [Scraper] Network idle. Resolving with ${itemsMap.size} items.`);
                            resolveSearch(true);
                        }, 2500);
                    }
                } catch (err) {}
            }
        });
        
        apiInterceptionTimeout = setTimeout(async () => {
            console.log(`🕷️ [Scraper] Warning: API interception timeout reached.`);
            resolveSearch(false);
        }, 45000);
    });

    try {
        const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
        const title = await page.title();
        if (response && response.status() === 403 || title.includes('ERROR: The request could not be satisfied')) {
            console.log(`🕷️ [Scraper] 🚨 FAST FAIL: Bot block detected.`);
            resolveSearch(false);
        }
        await searchDataPromise;
    } catch (error) {
        console.error(`🕷️ [Scraper] Error scraping URL ${targetUrl}:`, error.message);
    } finally {
        if (apiInterceptionTimeout) clearTimeout(apiInterceptionTimeout);
        if (debounceTimer) clearTimeout(debounceTimer);
        await browser.close();
    }
    
    return Array.from(itemsMap.values());
  }
}

module.exports = PlaywrightScraper;
