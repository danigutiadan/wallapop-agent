const { scrapeWallapop } = require('./scraper');

async function test() {
    const items = await scrapeWallapop({ keywords: 'iphone', order_by: 'newest' });
    if (items && items.length > 0) {
        console.log(JSON.stringify(items[0].images, null, 2));
    } else {
        console.log('No items found');
    }
}

test();
