const admin = require('firebase-admin');

class FirebaseRepository {
  constructor() {
    this.db = null;
    this.enabled = false;
    this.init();
  }

  init() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const buff = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64');
        const serviceAccount = JSON.parse(buff.toString('utf-8'));
        
        // Prevent re-initialization if already initialized
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
        }
        this.db = admin.firestore();
        this.enabled = true;
        console.log('🔥 [Firebase] Successfully connected to Firestore.');
      } catch (e) {
        console.error('🔥 [Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT:', e.message);
      }
    } else {
      console.log('🔥 [Firebase] FIREBASE_SERVICE_ACCOUNT not found in .env. Falling back to local files.');
    }
  }

  isFirebaseEnabled() {
    return this.enabled;
  }

  async getConfig() {
    if (!this.db) return null;
    try {
      const doc = await this.db.collection('wallapop-agent').doc('config').get();
      if (doc.exists) return doc.data();
    } catch (e) {
      console.error('🔥 [Firebase] Error fetching config:', e.message);
    }
    return null;
  }

  async saveConfig(configObj) {
    if (!this.db) return false;
    try {
      await this.db.collection('wallapop-agent').doc('config').set(configObj);
      return true;
    } catch (e) {
      console.error('🔥 [Firebase] Error saving config:', e.message);
      return false;
    }
  }

  async getSeenProducts() {
    if (!this.db) return null;
    try {
      const doc = await this.db.collection('wallapop-agent').doc('state').get();
      if (doc.exists) return doc.data().seenProductIds || [];
    } catch (e) {
      console.error('🔥 [Firebase] Error fetching seen products:', e.message);
    }
    return null;
  }

  async saveSeenProducts(seenProductIdsArray) {
    if (!this.db) return false;
    try {
      await this.db.collection('wallapop-agent').doc('state').set({
        seenProductIds: seenProductIdsArray
      });
      return true;
    } catch (e) {
      console.error('🔥 [Firebase] Error saving seen products:', e.message);
      return false;
    }
  }
}

module.exports = FirebaseRepository;
