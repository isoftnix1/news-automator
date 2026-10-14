import 'dotenv/config';
import { ensureSheet, flushOfflineQueue, appendArticles, readExistingUrls } from '../src/sheets.js';
import { loadStoredArticles } from '../src/storage.js';
import { stableKey } from '../src/utils.js';

async function main() {
  console.log('\n--- Syncing Articles to Google Sheets ---');
  try {
    const sheets = await ensureSheet();
    await flushOfflineQueue(sheets);

    const existing = await readExistingUrls(sheets);
    const stored = await loadStoredArticles();
    const fresh = stored.filter(item => !existing.has(stableKey(item.article || item).toLowerCase()));

    if (fresh.length > 0) {
      await appendArticles(sheets, fresh);
      console.log(`✓ Successfully appended ${fresh.length} articles to Google Sheet!`);
    } else {
      console.log(`All ${stored.length} stored articles are already present in the Google Sheet.`);
    }
    console.log('✓ Sync completed successfully!\n');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

main();
