import 'dotenv/config';
import { evaluateArticle } from '../src/evaluator.js';

async function main() {
  console.log('\n--- Testing Gemini AI Evaluation ---');
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('❌ GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }
  console.log(`Model configured: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash (default)'}`);

  const mockArticle = {
    title: 'Tata Power to invest ₹4,000 crore in 12 GWh BESS project in Maharashtra',
    url: 'https://example.com/tata-bess-maharashtra',
    source: 'The Economic Times',
    publishedAt: new Date().toISOString(),
    description: 'Tata Power Renewable Energy has signed an agreement to deploy a 12 GWh battery energy storage system (BESS) facility in Maharashtra with an investment of ₹4,000 crore.',
    matchedKeywords: ['BESS', 'battery energy storage system', 'manufacturing capex'],
    categoryHint: 'BESS & Energy Storage',
    regionHint: 'India'
  };

  console.log('Sending sample article to Gemini for scoring...');
  const t0 = Date.now();
  try {
    const result = await evaluateArticle(mockArticle);
    const duration = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n✓ Gemini AI evaluation succeeded in ${duration}s!`);
    console.log('Evaluation Output:');
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nRelevant: ${result.relevant ? 'YES (Meets threshold)' : 'NO'}`);
    console.log('All Gemini AI checks PASSED!\n');
  } catch (error) {
    console.error('\n❌ Gemini Evaluation Error:', error.message);
    process.exit(1);
  }
}

main();
