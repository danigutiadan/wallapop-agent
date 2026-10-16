require('dotenv').config();

const MultiProviderScraper = require('./infrastructure/scraper/MultiProviderScraper');
const FirebaseRepository = require('./infrastructure/database/FirebaseRepository');
const LocalFileRepository = require('./infrastructure/database/LocalFileRepository');
const TelegramNotifier = require('./infrastructure/notifications/TelegramNotifier');
const CheckNewItemsUseCase = require('./application/use-cases/CheckNewItemsUseCase');

async function main() {
  const args = process.argv.slice(2);
  const runOnce = args.includes('--run-once');
  const dryRun = args.includes('--dry-run');
  const testNotify = args.includes('--test-notify');

  console.log('========================================');
  console.log(' WALLAPOP & VINTED SEARCH AGENT (CLEAN) ');
  console.log('========================================');

  // 1. Initialize Infrastructure (Adapters)
  const scraper = new MultiProviderScraper();
  const database = new FirebaseRepository();
  const localDatabase = new LocalFileRepository();
  const notifier = new TelegramNotifier();

  // 2. Initialize Application (Use Cases)
  const checkNewItemsUseCase = new CheckNewItemsUseCase(scraper, database, localDatabase, notifier);
  await checkNewItemsUseCase.init();

  // 3. Handle Arguments
  if (testNotify) {
    await checkNewItemsUseCase.sendTestNotification();
    process.exit(0);
  }

  if (runOnce) {
    await checkNewItemsUseCase.run({ dryRun });
    process.exit(0);
  }

  // 4. Start Loop
  await checkNewItemsUseCase.run({ dryRun });
  
  const intervalMs = (checkNewItemsUseCase.config.check_interval_minutes || 5) * 60 * 1000;
  console.log(`🤖 [Agent] Scheduling check loop every ${checkNewItemsUseCase.config.check_interval_minutes} minutes (${intervalMs}ms).`);
  
  setInterval(async () => {
    await checkNewItemsUseCase.run({ dryRun });
  }, intervalMs);
}

main().catch(err => {
  console.error('🤖 [Agent] Fatal error:', err);
  process.exit(1);
});
