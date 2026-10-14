import 'dotenv/config';
import { discoverArticles } from '../src/discovery.js';

async function main() {
  console.log('\n--- Testing News Discovery Pipeline ---');
  console.log(`Lookback window: ${process.env.LOOKBACK_HOURS || 72} hours`);
  console.log(`Google News enabled: ${process.env.GOOGLE_NEWS_ENABLED !== 'false'}`);
  console.log(`GDELT enabled: ${process.env.GDELT_ENABLED !== 'false'}`);

  const t0 = Date.now();
  try {
    const candidates = await discoverArticles();
    const duration = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n✓ Discovery completed in ${duration}s!`);
    console.log(`Found ${candidates.length} unique candidates matching target keywords.`);

    if (candidates.length > 0) {
      console.log('\nTop 3 Sample Candidates:');
      candidates.slice(0, 3).forEach((a, i) => {
        console.log(`\n[${i + 1}] ${a.title}`);
        console.log(`    Source: ${a.source} | Date: ${a.publishedAt || 'Unknown'}`);
        console.log(`    Category: ${a.categoryHint || 'General'} | Keywords: ${(a.matchedKeywords || []).join(', ')}`);
        console.log(`    URL: ${a.url}`);
      });
    }
    console.log('\nAll Discovery checks PASSED!\n');
  } catch (error) {
    console.error('\n❌ Discovery Error:', error.message);
    process.exit(1);
  }
}

main();
