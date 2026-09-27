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
        let serviceAccount;
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
        const fs = require('fs');

        if (fs.existsSync(raw)) {
          serviceAccount = JSON.parse(fs.readFileSync(raw, 'utf-8'));
        } else if (raw.startsWith('{')) {
          serviceAccount = JSON.parse(raw);
        } else {
          try {
            const buff = Buffer.from(raw, 'base64');
            serviceAccount = JSON.parse(buff.toString('utf-8'));
          } catch {
            serviceAccount = JSON.parse(raw);
          }
        }
        
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

  async getAllUsers() {
    if (!this.db) return [];
    try {
      const snapshot = await this.db.collection('users').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.error('🔥 [Firebase] Error fetching all users:', e.message);
      return [];
    }
  }

  async getUser(userId) {
    if (!this.db || !userId) return null;
    try {
      const doc = await this.db.collection('users').doc(userId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
    } catch (e) {
      console.error(`🔥 [Firebase] Error fetching user ${userId}:`, e.message);
    }
    return null;
  }

  async saveUser(userId, data) {
    if (!this.db || !userId) return false;
    try {
      await this.db.collection('users').doc(userId).set(data, { merge: true });
      return true;
    } catch (e) {
      console.error(`🔥 [Firebase] Error saving user ${userId}:`, e.message);
      return false;
    }
  }

  async getUserSeenProducts(userId) {
    if (!this.db || !userId) return [];
    try {
      const doc = await this.db.collection('users').doc(userId).collection('state').doc('seen').get();
      const seen = doc.exists ? (doc.data()?.seenProductIds || []) : [];
      if (seen.length === 0 && userId === 'CoZSISpMSdMZZCUUlud7nmo7kS12') {
        const legacySeen = await this.getSeenProducts();
        if (legacySeen && legacySeen.length > 0) {
          return legacySeen;
        }
      }
      return seen;
    } catch (e) {
      console.error(`🔥 [Firebase] Error fetching seen products for user ${userId}:`, e.message);
      if (userId === 'CoZSISpMSdMZZCUUlud7nmo7kS12') {
        return (await this.getSeenProducts()) || [];
      }
      return [];
    }
  }

  async saveUserSeenProducts(userId, seenProductIdsArray) {
    if (!this.db || !userId) return false;
    try {
      await this.db.collection('users').doc(userId).collection('state').doc('seen').set({
        seenProductIds: seenProductIdsArray,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      if (userId === 'CoZSISpMSdMZZCUUlud7nmo7kS12') {
        await this.saveSeenProducts(seenProductIdsArray);
      }
      return true;
    } catch (e) {
      console.error(`🔥 [Firebase] Error saving seen products for user ${userId}:`, e.message);
      return false;
    }
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
