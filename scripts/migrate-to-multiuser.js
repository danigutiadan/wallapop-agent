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

  // 1. Find or verify target user from CLI arguments or environment variables
  const args = process.argv.slice(2);
  const uidIndex = args.indexOf('--uid');
  const emailIndex = args.indexOf('--email');
  const inputUid = (uidIndex !== -1 ? args[uidIndex + 1] : null) || process.env.TARGET_UID;
  const inputEmail = (emailIndex !== -1 ? args[emailIndex + 1] : null) || process.env.TARGET_EMAIL;

  if (!inputUid && !inputEmail) {
    console.error('❌ Please specify a target user via --uid <uid> or --email <email> (or TARGET_UID / TARGET_EMAIL env vars).');
    process.exit(1);
  }

  let targetUid = null;
  let targetEmail = null;

  try {
    if (inputUid) {
      const userRecord = await admin.auth().getUser(inputUid);
      targetUid = userRecord.uid;
      targetEmail = userRecord.email;
    } else {
      const userRecord = await admin.auth().getUserByEmail(inputEmail);
      targetUid = userRecord.uid;
      targetEmail = userRecord.email;
    }
    console.log(`✅ Target user confirmed: ${targetEmail} (UID: ${targetUid})`);
  } catch (err) {
    console.error(`❌ Target user not found in Firebase Auth: ${err.message}`);
    console.error('❌ Migration aborted. No fallback user will be used.');
    process.exit(1);
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

  // 4. Telegram credentials from CLI arguments (optional)
  const botTokenIndex = args.indexOf('--telegram-token');
  const chatIdIndex = args.indexOf('--telegram-chat-id');
  const telegramBotToken = (botTokenIndex !== -1 ? args[botTokenIndex + 1] : '') || '';
  const telegramChatId = (chatIdIndex !== -1 ? args[chatIdIndex + 1] : '') || '';
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
