const fs = require('fs');

class LocalFileRepository {
  constructor() {
    this.configPath = 'config.json';
    this.statePath = 'seenProducts.json';
  }

  async getConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      } catch (err) {
        console.error('Error reading local config:', err.message);
      }
    }
    return null;
  }

  async saveConfig(configObj) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(configObj, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving local config:', err.message);
      return false;
    }
  }

  async getSeenProducts() {
    if (fs.existsSync(this.statePath)) {
      try {
        const data = fs.readFileSync(this.statePath, 'utf-8');
        return JSON.parse(data);
      } catch (err) {
        console.error('Error reading local state:', err.message);
      }
    }
    return [];
  }

  async saveSeenProducts(seenProductIdsArray) {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(seenProductIdsArray, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Error saving local state:', err.message);
      return false;
    }
  }
}

module.exports = LocalFileRepository;
