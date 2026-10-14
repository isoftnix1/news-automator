import 'dotenv/config';
import { ensureSheet, readExistingUrls, getClientEmail, spreadsheetId } from '../src/sheets.js';

async function main() {
  console.log('\n--- Testing Google Sheets Connection ---');
  const email = await getClientEmail();
  const id = process.env.GOOGLE_SHEET_ID;
  console.log(`Service Account: ${email}`);
  console.log(`Target Sheet ID: ${id}`);
  console.log(`URL: https://docs.google.com/spreadsheets/d/${id}/edit\n`);

  try {
    const sheets = await ensureSheet();
    console.log('✓ Successfully authenticated and connected to Google Sheets API.');
    const existing = await readExistingUrls(sheets);
    console.log(`✓ Read existing URLs from sheet: ${existing.size} unique URLs already indexed.`);
    console.log('\nAll Google Sheets checks PASSED! The bot is ready to write data.\n');
  } catch (error) {
    if (error.code === 403 || error.message?.includes('caller does not have permission')) {
      console.error('\n❌ Google Sheets Permission Denied!');
      console.error('Please share the Google Sheet with Editor permission:');
      console.error(`1. Go to: https://docs.google.com/spreadsheets/d/${id}/edit`);
      console.error(`2. Click "Share" (top-right)`);
      console.error(`3. Paste: ${email}`);
      console.error(`4. Set role to "Editor" and click "Send/Share".\n`);
    } else {
      console.error('\n❌ Google Sheets Error:', error.message);
    }
    process.exit(1);
  }
}

main();
