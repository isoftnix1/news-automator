import 'dotenv/config';
import cron from 'node-cron';
import { discoverArticles } from './discovery.js';
import { evaluateArticle } from './evaluator.js';
import { ensureSheet, readExistingUrls, appendArticles, saveToOfflineQueue, flushOfflineQueue } from './sheets.js';
import { upsertStoredArticles } from './storage.js';
import { stableKey, log } from './utils.js';

let running = false;

export async function runCycle() {
  if (running) {
    log('warn', 'Previous run is still active; skipping overlapping cycle.');
    return;
  }
  running = true;
  const started = Date.now();
  try {
    log('info', 'Starting news discovery cycle...');

    // Attempt Google Sheets connection
    let sheets = null;
    let existing = new Set();
    try {
      sheets = await ensureSheet();
      existing = await readExistingUrls(sheets);
      await flushOfflineQueue(sheets);
    } catch (err) {
      log('warn', `Google Sheets currently inaccessible (${err.message}). New accepted articles will be preserved locally in offline queue.`);
    }

    const candidates = await discoverArticles();
    const fresh = candidates.filter(a => !existing.has(stableKey(a).toLowerCase()));
    log('info', `${fresh.length} candidates are new; ${candidates.length - fresh.length} already exist in Google Sheets`);

    const maxEvals = Number(process.env.MAX_EVALUATIONS_PER_RUN || 25);
    const toEvaluate = fresh.slice(0, maxEvals);
    if (fresh.length > maxEvals) {
      log('info', `Evaluating top ${maxEvals} of ${fresh.length} fresh candidates in this cycle to respect rate limits.`);
    }

    const accepted = [];
    for (const article of toEvaluate) {
      try {
        const evaluation = await evaluateArticle(article);
        log('info', `[Score ${evaluation.score}/100] [${evaluation.relevant ? 'ACCEPTED' : 'FILTERED'}] ${article.title}`);
        if (evaluation.relevant) {
          accepted.push({ article, evaluation });
          existing.add(stableKey(article).toLowerCase());
        }
      } catch (error) {
        log('warn', `Could not evaluate article: ${article.title}: ${error.message}`);
      }
      // Quota-friendly pace between AI calls
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (accepted.length > 0) {
      await upsertStoredArticles(accepted);
      if (sheets) {
        await appendArticles(sheets, accepted);
        log('info', `Saved ${accepted.length} high-relevance articles to Google Sheets!`);
      } else {
        await saveToOfflineQueue(accepted);
        log('info', `Queued ${accepted.length} accepted articles in offline queue (ready to sync once Sheets access is granted).`);
      }
    } else {
      log('info', 'No articles met the minimum relevance threshold in this cycle.');
    }

    log('info', `Cycle complete: ${accepted.length} accepted, ${((Date.now() - started) / 1000).toFixed(1)}s elapsed`);
  } catch (error) {
    log('error', `Cycle failed: ${error.stack || error.message}`);
  } finally {
    running = false;
  }
}

const everyHours = Math.max(1, Math.min(23, Number(process.env.SEARCH_EVERY_HOURS || 3)));
const schedule = `0 */${everyHours} * * *`;

if (process.argv.includes('--once')) {
  await runCycle();
  process.exit(0);
}

if ((process.env.RUN_ON_START || 'true').toLowerCase() === 'true') {
  await runCycle();
}

cron.schedule(schedule, () => void runCycle(), { timezone: 'UTC' });
log('info', `News bot running. Schedule: ${schedule} (UTC); threshold: ${process.env.MIN_RELEVANCE_SCORE || 75}/100`);
