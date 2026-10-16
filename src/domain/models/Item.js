class Item {
  constructor({ id, title, description, price, location, web_slug, images, originalData, provider = 'wallapop', itemUrl = null }) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.price = price; // { amount, currency }
    this.location = location; // { city, region2 }
    this.web_slug = web_slug;
    this.images = images || [];
    this.originalData = originalData || {};
    this.provider = provider;
    this.itemUrl = itemUrl;
    this.sellerStats = null;
  }

  get userId() {
    if (!this.originalData) return null;
    return this.originalData.user_id || this.originalData.user?.id || this.originalData.ownerId || null;
  }

  get providerName() {
    return this.provider === 'vinted' ? 'Vinted' : 'Wallapop';
  }

  get url() {
    if (this.itemUrl) {
      return this.itemUrl;
    }
    if (this.provider === 'vinted') {
      if (!this.web_slug) return 'https://www.vinted.es';
      return this.web_slug.startsWith('http')
        ? this.web_slug
        : `https://www.vinted.es${this.web_slug.startsWith('/') ? '' : '/items/'}${this.web_slug}`;
    }
    return `https://es.wallapop.com/item/${this.web_slug}`;
  }

  get priceString() {
    return this.price ? `${this.price.amount} ${this.price.currency}` : 'Precio no disponible';
  }
}

module.exports = Item;
