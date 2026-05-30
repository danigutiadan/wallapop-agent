const admin = require('firebase-admin');

let isFirebaseEnabled = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        // We decode the base64 string provided in the .env
        const buff = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64');
        const serviceAccount = JSON.parse(buff.toString('utf-8'));
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        isFirebaseEnabled = true;
        console.log('🔥 [Firebase] Successfully connected to Firestore.');
    } catch (e) {
        console.error('🔥 [Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT:', e.message);
    }
} else {
    console.log('🔥 [Firebase] FIREBASE_SERVICE_ACCOUNT not found in .env. Falling back to local files.');
}

function getDb() {
    if (!isFirebaseEnabled) return null;
    return admin.firestore();
}

async function getRemoteConfig() {
    const db = getDb();
    if (!db) return null;
    
    try {
        const doc = await db.collection('wallapop-agent').doc('config').get();
        if (doc.exists) {
            return doc.data();
        }
    } catch (e) {
        console.error('🔥 [Firebase] Error fetching config:', e.message);
    }
    return null;
}

async function saveRemoteConfig(configObj) {
    const db = getDb();
    if (!db) return false;
    
    try {
        await db.collection('wallapop-agent').doc('config').set(configObj);
        return true;
    } catch (e) {
        console.error('🔥 [Firebase] Error saving config:', e.message);
        return false;
    }
}

async function getRemoteSeenProducts() {
    const db = getDb();
    if (!db) return null;
    
    try {
        const doc = await db.collection('wallapop-agent').doc('state').get();
        if (doc.exists) {
            return doc.data().seenProductIds || [];
        }
    } catch (e) {
        console.error('🔥 [Firebase] Error fetching seen products:', e.message);
    }
    return null;
}

async function saveRemoteSeenProducts(seenProductIdsArray) {
    const db = getDb();
    if (!db) return false;
    
    try {
        await db.collection('wallapop-agent').doc('state').set({
            seenProductIds: seenProductIdsArray
        });
        return true;
    } catch (e) {
        console.error('🔥 [Firebase] Error saving seen products:', e.message);
        return false;
    }
}

module.exports = {
    isFirebaseEnabled: () => isFirebaseEnabled,
    getRemoteConfig,
    saveRemoteConfig,
    getRemoteSeenProducts,
    saveRemoteSeenProducts
};
