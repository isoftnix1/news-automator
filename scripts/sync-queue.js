import 'dotenv/config';
import { ensureSheet, flushOfflineQueue } from '../src/sheets.js';

async function main() {
  console.log('\n--- Syncing Offline Queue to Google Sheets ---');
  try {
    const sheets = await ensureSheet();
    await flushOfflineQueue(sheets);
    console.log('✓ Offline queue sync completed successfully!\n');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

main();
