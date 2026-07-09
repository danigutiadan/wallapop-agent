class Item {
  constructor({ id, title, description, price, location, web_slug, images, originalData }) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.price = price; // { amount, currency }
    this.location = location; // { city, region2 }
    this.web_slug = web_slug;
    this.images = images || [];
    this.originalData = originalData || {};
    this.sellerStats = null;
  }

  get userId() {
    return this.originalData ? this.originalData.user_id : null;
  }

  get url() {
    return `https://es.wallapop.com/item/${this.web_slug}`;
  }

  get priceString() {
    return this.price ? `${this.price.amount} ${this.price.currency}` : 'Precio no disponible';
  }
}

module.exports = Item;
