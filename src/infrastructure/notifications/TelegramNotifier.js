class TelegramNotifier {
  constructor(botToken = null, chatId = null) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  isConfigured() {
    return !!(this.botToken && this.chatId);
  }

  formatDescription(desc, limit = 200) {
    if (!desc) return 'Sin descripción.';
    let clean = desc.trim();
    if (clean.length > limit) {
      clean = clean.substring(0, limit) + '...';
    }
    return clean;
  }

  async sendNotification(item, searchName) {
    if (!this.isConfigured()) {
      console.error('📨 [Notifier] Telegram is enabled but bot_token or chat_id is missing.');
      return false;
    }

    const priceText = item.priceString;
    const locationText = item.location
      ? (item.location.region2 || item.location.region
          ? `${item.location.city} (${item.location.region2 || item.location.region})`
          : `${item.location.city}`)
      : 'No disponible';
    const cleanDesc = this.formatDescription(item.description, 250);
    const providerName = item.providerName || (item.provider === 'vinted' ? 'Vinted' : 'Wallapop');

    const text = `<b>🔔 ¡Nuevo producto en ${providerName}!</b>\n` +
                 `<b>Filtro:</b> ${searchName}\n\n` +
                 `<b>Título:</b> ${item.title}\n` +
                 `<b>Precio:</b> ${priceText}\n` +
                 `<b>Ubicación:</b> ${locationText}\n\n` +
                 `<b>Descripción:</b>\n<i>${cleanDesc}</i>\n\n` +
                 `🔗 <a href="${item.url}">Ver producto en ${providerName}</a>`;

    const imageUrl = item.images && item.images.length > 0
      ? (item.images[0].urls?.big || item.images[0].urls?.medium || item.images[0].url || null)
      : null;

    let apiUrl, requestBody;
    
    if (imageUrl) {
        apiUrl = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
        requestBody = {
            chat_id: this.chatId,
            photo: imageUrl,
            caption: text,
            parse_mode: 'HTML'
        };
    } else {
        apiUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        requestBody = {
            chat_id: this.chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: false
        };
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const json = await response.json();
        if (json.ok) {
            console.log(`📨 [Notifier] Telegram notification sent for item: "${item.title}"`);
            return true;
        } else {
            console.error('📨 [Notifier] Telegram API returned error:', json);
            return false;
        }
    } catch (error) {
        console.error('📨 [Notifier] Error sending Telegram notification:', error.message);
        return false;
    }
  }
}

module.exports = TelegramNotifier;
