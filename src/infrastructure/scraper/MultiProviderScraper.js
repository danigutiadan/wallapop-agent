const PlaywrightScraper = require('./PlaywrightScraper');
const VintedPlaywrightScraper = require('./VintedPlaywrightScraper');

class MultiProviderScraper {
  constructor(wallapopScraper = new PlaywrightScraper(), vintedScraper = new VintedPlaywrightScraper()) {
    this.wallapopScraper = wallapopScraper;
    this.vintedScraper = vintedScraper;
  }

  async scrape(searchConfig) {
    let wallapopItems = [];
    let vintedItems = [];

    const isWallapopEnabled = searchConfig.wallapop_enabled !== false;
    const isVintedEnabled = searchConfig.vinted_enabled !== false;

    if (isWallapopEnabled) {
      try {
        wallapopItems = await this.wallapopScraper.scrape(searchConfig);
        console.log(`🕷️ [MultiScraper] Wallapop returned ${wallapopItems.length} item(s).`);
      } catch (error) {
        console.error(`🕷️ [MultiScraper] Error scraping Wallapop:`, error.message);
      }
    } else {
      console.log(`🕷️ [MultiScraper] Wallapop is disabled for search "${searchConfig.name || searchConfig.keywords || ''}". Skipping.`);
    }

    if (isVintedEnabled) {
      try {
        vintedItems = await this.vintedScraper.scrape(searchConfig);
        console.log(`👗 [MultiScraper] Vinted returned ${vintedItems.length} item(s).`);
      } catch (error) {
        console.error(`👗 [MultiScraper] Error scraping Vinted:`, error.message);
      }
    } else {
      console.log(`👗 [MultiScraper] Vinted is disabled for search "${searchConfig.name || searchConfig.keywords || ''}". Skipping.`);
    }

    return [...wallapopItems, ...vintedItems];
  }

  async getSellerStats(userId, provider = 'wallapop') {
    if (provider === 'vinted') {
      return await this.vintedScraper.getSellerStats(userId);
    }
    return await this.wallapopScraper.getSellerStats(userId);
  }

  async close() {
    await Promise.allSettled([
      this.wallapopScraper?.close?.(),
      this.vintedScraper?.close?.()
    ]);
  }
}

module.exports = MultiProviderScraper;
