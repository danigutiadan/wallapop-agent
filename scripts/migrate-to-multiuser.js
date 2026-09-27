require('dotenv').config();
const admin = require('firebase-admin');
const FirebaseRepository = require('../src/infrastructure/database/FirebaseRepository');

async function migrate() {
  console.log('====================================================');
  console.log('     MIGRATION TO MULTI-USER FIRESTORE STRUCTURE    ');
  console.log('====================================================');

  const repo = new FirebaseRepository();
  if (!repo.isFirebaseEnabled()) {
    console.error('❌ Firebase is not enabled. Please check FIREBASE_SERVICE_ACCOUNT.');
    process.exit(1);
  }

  const db = repo.db;

  // 1. Find or verify target user
  let targetUid = 'CoZSISpMSdMZZCUUlud7nmo7kS12';
  let targetEmail = 'danigutiadan4@gmail.com';

  try {
    const listUsers = await admin.auth().listUsers();
    console.log(`ℹ️ Found ${listUsers.users.length} user(s) in Firebase Auth.`);
    const existing = listUsers.users.find(u => u.uid === targetUid || u.email === targetEmail);
    if (existing) {
      targetUid = existing.uid;
      targetEmail = existing.email;
      console.log(`✅ Target user confirmed: ${targetEmail} (UID: ${targetUid})`);
    } else if (listUsers.users.length > 0) {
      targetUid = listUsers.users[0].uid;
      targetEmail = listUsers.users[0].email;
      console.log(`ℹ️ Using first user found: ${targetEmail} (UID: ${targetUid})`);
    }
  } catch (err) {
    console.warn('⚠️ Could not list Auth users, using default UID:', err.message);
  }

  // 2. Read legacy config
  console.log('\n📦 Reading legacy config from collection "wallapop-agent", doc "config"...');
  const legacyConfigSnap = await db.collection('wallapop-agent').doc('config').get();
  if (!legacyConfigSnap.exists) {
    console.error('❌ Legacy config doc "wallapop-agent/config" does not exist!');
    process.exit(1);
  }
  const legacyConfig = legacyConfigSnap.data();
  const searches = legacyConfig.searches || [];
  console.log(`✅ Loaded ${searches.length} searches from legacy config.`);

  // 3. Read legacy state
  console.log('\n📦 Reading legacy state from collection "wallapop-agent", doc "state"...');
  const legacyStateSnap = await db.collection('wallapop-agent').doc('state').get();
  let seenProductIds = [];
  if (legacyStateSnap.exists) {
    seenProductIds = legacyStateSnap.data().seenProductIds || [];
    console.log(`✅ Loaded ${seenProductIds.length} seen product IDs from legacy state.`);
  } else {
    console.warn('⚠️ Legacy state not found, default to empty array.');
  }

  // 4. Telegram credentials from .env
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
  const telegramEnabled = legacyConfig.notifications?.telegram?.enabled !== false;
  console.log(`ℹ️ Telegram config: token=${telegramBotToken ? '***' + telegramBotToken.slice(-5) : 'none'}, chatId=${telegramChatId || 'none'}, enabled=${telegramEnabled}`);

  // 5. Migrate to users/{userId}
  console.log(`\n🚀 Migrating data to "users/${targetUid}"...`);
  const userDocRef = db.collection('users').doc(targetUid);
  await userDocRef.set({
    email: targetEmail,
    searches: searches,
    telegram: {
      bot_token: telegramBotToken,
      chat_id: telegramChatId,
      enabled: telegramEnabled
    },
    updatedAt: new Date().toISOString()
  }, { merge: true });
  console.log(`✅ Migrated user document: users/${targetUid}`);

  // 6. Migrate to users/{userId}/state/seen
  console.log(`🚀 Migrating seen products to "users/${targetUid}/state/seen"...`);
  const stateDocRef = db.collection('users').doc(targetUid).collection('state').doc('seen');
  await stateDocRef.set({
    seenProductIds: seenProductIds,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  console.log(`✅ Migrated seen products document: users/${targetUid}/state/seen (${seenProductIds.length} items)`);

  // 7. Verify migration
  console.log('\n🔍 Verifying migrated data...');
  const verifyUser = await userDocRef.get();
  const verifyState = await stateDocRef.get();

  if (!verifyUser.exists || !verifyState.exists) {
    console.error('❌ Verification failed: documents not found!');
    process.exit(1);
  }

  const verifiedSearches = verifyUser.data().searches || [];
  const verifiedSeen = verifyState.data().seenProductIds || [];
  const verifiedTelegram = verifyUser.data().telegram;

  console.log(`✅ Verified searches count: ${verifiedSearches.length} (expected: ${searches.length})`);
  console.log(`✅ Verified seen count: ${verifiedSeen.length} (expected: ${seenProductIds.length})`);
  console.log(`✅ Verified telegram: token=${verifiedTelegram?.bot_token ? 'Present' : 'None'}, chatId=${verifiedTelegram?.chat_id}`);

  console.log('\n🔒 IMPORTANT: The legacy documents "wallapop-agent/config" and "wallapop-agent/state" remain completely UNTOUCHED as a backup.');
  console.log('🎉 Migration completed successfully!');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
