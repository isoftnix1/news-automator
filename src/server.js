import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, discoverArticles } from './discovery.js';
import { evaluateArticle } from './evaluator.js';
import { ensureSheet, appendArticles, readExistingUrls, getClientEmail, flushOfflineQueue } from './sheets.js';
import { loadStoredArticles, upsertStoredArticles } from './storage.js';
import { stableKey, log } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const KEYWORDS_PATH = path.resolve(__dirname, '../config/keywords.json');
const DEFAULT_KEYWORDS_PATH = path.resolve(__dirname, '../config/keywords.default.json');
const QUEUE_PATH = path.resolve(__dirname, '../data/offline_queue.json');

// --- API ENDPOINTS ---

// 1. Get Keywords
app.get('/api/keywords', async (req, res) => {
  try {
    const raw = await fs.readFile(KEYWORDS_PATH, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load keywords: ' + err.message });
  }
});

// 2. Save / Update Keywords
app.post('/api/keywords', async (req, res) => {
  try {
    const { categories, regions } = req.body;
    if (!Array.isArray(categories)) {
      return res.status(400).json({ error: 'Categories must be an array' });
    }
    const payload = {
      categories: categories.map(c => ({
        name: String(c.name || 'Custom Category').trim(),
        keywords: Array.isArray(c.keywords) ? [...new Set(c.keywords.map(k => String(k).trim()).filter(Boolean))] : []
      })).filter(c => c.keywords.length > 0),
      regions: Array.isArray(regions) ? regions : ['India', 'worldwide']
    };
    await fs.writeFile(KEYWORDS_PATH, JSON.stringify(payload, null, 2), 'utf8');
    log('info', 'Updated keywords configuration from Web UI');
    res.json({ success: true, config: payload });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save keywords: ' + err.message });
  }
});

// 3. Reset Keywords to Default
app.post('/api/keywords/reset', async (req, res) => {
  try {
    const defaultData = await fs.readFile(DEFAULT_KEYWORDS_PATH, 'utf8');
    await fs.writeFile(KEYWORDS_PATH, defaultData, 'utf8');
    log('info', 'Reset keywords to defaults via Web UI');
    res.json({ success: true, config: JSON.parse(defaultData) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset keywords: ' + err.message });
  }
});

// 4. Get Stored Articles
app.get('/api/articles', async (req, res) => {
  try {
    const { q, category, minScore, limit } = req.query;
    let articles = await loadStoredArticles();

    if (category && category !== 'All') {
      const catLower = category.toLowerCase();
      articles = articles.filter(a => {
        const cat = (a.evaluation?.category || a.category || a.article?.categoryHint || '').toLowerCase();
        return cat.includes(catLower);
      });
    }

    if (minScore) {
      const threshold = Number(minScore) || 0;
      articles = articles.filter(a => (a.evaluation?.score ?? a.score ?? 0) >= threshold);
    }

    if (q) {
      const search = q.toLowerCase();
      articles = articles.filter(a => {
        const text = `${a.article?.title || a.title || ''} ${a.evaluation?.summary || a.summary || ''} ${a.evaluation?.companies || ''} ${(a.article?.matchedKeywords || []).join(' ')}`.toLowerCase();
        return text.includes(search);
      });
    }

    const maxLimit = limit ? Number(limit) : 200;
    res.json({
      total: articles.length,
      articles: articles.slice(0, maxLimit)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load articles: ' + err.message });
  }
});

// 5. Trigger Scan & Discovery on Demand
let isScanning = false;
app.post('/api/scan', async (req, res) => {
  if (isScanning) {
    return res.status(429).json({ error: 'A news scan is already actively running. Please wait.' });
  }

  isScanning = true;
  const started = Date.now();
  try {
    const maxEvals = Number(req.body.maxEvals || process.env.MAX_EVALUATIONS_PER_RUN || 20);
    const minScore = Number(process.env.MIN_RELEVANCE_SCORE || 75);

    log('info', `[Web UI] Starting on-demand news discovery scan (max evals: ${maxEvals})...`);

    // 1. Discover candidates
    const candidates = await discoverArticles();

    // 2. Read existing to deduplicate
    const stored = await loadStoredArticles();
    const seen = new Set(stored.map(s => stableKey(s.article || s).toLowerCase()));

    let fresh = candidates.filter(a => !seen.has(stableKey(a).toLowerCase()));

    // If specific keyword filter passed from UI
    if (req.body.keyword) {
      const kw = req.body.keyword.toLowerCase();
      fresh = fresh.filter(a =>
        `${a.title} ${a.description}`.toLowerCase().includes(kw) ||
        (a.matchedKeywords || []).some(k => k.toLowerCase().includes(kw))
      );
    }

    // If specific category filter passed from UI
    if (req.body.category && req.body.category !== 'All') {
      const cat = req.body.category.toLowerCase();
      fresh = fresh.filter(a =>
        (a.categoryHint || '').toLowerCase().includes(cat) ||
        (a.matchedKeywords || []).some(k => k.toLowerCase().includes(cat))
      );
    }

    log('info', `[Web UI] Discovered ${candidates.length} total, ${fresh.length} fresh candidates`);

    let toEvaluate = [];
    if (req.body.keyword || (req.body.category && req.body.category !== 'All')) {
      toEvaluate = fresh.slice(0, maxEvals);
    } else {
      // Balanced selection: group candidates by primary category/hint
      const byCategory = new Map();
      for (const item of fresh) {
        const cat = item.categoryHint || item.matchedKeywords?.[0] || 'General';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
      }

      // Round-robin pick across categories so every category gets evaluated
      const categoryBuckets = Array.from(byCategory.values());
      while (toEvaluate.length < maxEvals && categoryBuckets.some(b => b.length > 0)) {
        for (const bucket of categoryBuckets) {
          if (bucket.length > 0 && toEvaluate.length < maxEvals) {
            toEvaluate.push(bucket.shift());
          }
        }
      }
    }
    const evaluatedResults = [];

    for (const article of toEvaluate) {
      try {
        const evaluation = await evaluateArticle(article);
        log('info', `[Web UI] Scored ${evaluation.score}/100: ${article.title}`);
        evaluatedResults.push({ article, evaluation });
      } catch (err) {
        log('warn', `[Web UI] Evaluation skipped: ${article.title}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }

    // Save all newly evaluated items to local store
    if (evaluatedResults.length > 0) {
      await upsertStoredArticles(evaluatedResults);
    }

    // Attempt sheets sync for qualified articles
    const qualified = evaluatedResults.filter(item => item.evaluation.score >= minScore);
    let sheetsSynced = 0;
    let sheetsError = null;

    if (qualified.length > 0) {
      try {
        const sheets = await ensureSheet();
        await appendArticles(sheets, qualified);
        sheetsSynced = qualified.length;
      } catch (err) {
        sheetsError = err.message;
        log('warn', `Could not auto-append to sheets during scan: ${err.message}`);
      }
    }

    res.json({
      success: true,
      timeMs: Date.now() - started,
      discoveredCount: candidates.length,
      freshCount: fresh.length,
      evaluatedCount: evaluatedResults.length,
      acceptedCount: qualified.length,
      sheetsSynced,
      sheetsError,
      articles: evaluatedResults
    });
  } catch (err) {
    log('error', `[Web UI] Scan failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    isScanning = false;
  }
});

// 6. Push a single article directly to Google Sheets
app.post('/api/articles/push', async (req, res) => {
  try {
    const item = req.body.item;
    if (!item) return res.status(400).json({ error: 'Item is required' });

    const sheets = await ensureSheet();
    await appendArticles(sheets, [item]);
    res.json({ success: true, message: 'Article saved to Google Sheets' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to push article: ' + err.message });
  }
});

// 7. Sync Offline Queue to Google Sheets
app.post('/api/sync', async (req, res) => {
  try {
    const sheets = await ensureSheet();
    await flushOfflineQueue(sheets);
    const stored = await loadStoredArticles();
    if (stored.length > 0) {
      await appendArticles(sheets, stored);
    }
    res.json({ success: true, message: `Synced ${stored.length} articles to Google Sheets!` });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// 7b. Update Google Sheet ID or URL and immediately test/sync
app.post('/api/sheet/config', async (req, res) => {
  try {
    const { sheetUrl, sheetId } = req.body;
    let targetId = sheetId;
    if (sheetUrl) {
      const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) targetId = match[1];
      else targetId = sheetUrl.trim();
    }
    if (!targetId) {
      return res.status(400).json({ error: 'Valid Google Sheet ID or URL is required' });
    }

    process.env.GOOGLE_SHEET_ID = targetId;

    // Update .env file on disk
    const envPath = path.resolve(__dirname, '../.env');
    try {
      let envContent = await fs.readFile(envPath, 'utf8');
      if (envContent.includes('GOOGLE_SHEET_ID=')) {
        envContent = envContent.replace(/GOOGLE_SHEET_ID=.*/, `GOOGLE_SHEET_ID=${targetId}`);
      } else {
        envContent += `\nGOOGLE_SHEET_ID=${targetId}`;
      }
      await fs.writeFile(envPath, envContent, 'utf8');
    } catch {}

    // Verify access
    try {
      const sheets = await ensureSheet();
      const stored = await loadStoredArticles();
      if (stored.length > 0) {
        await appendArticles(sheets, stored);
      }
      res.json({
        success: true,
        connected: true,
        sheetId: targetId,
        syncedCount: stored.length,
        message: `Connected successfully! Synced ${stored.length} articles to Google Sheets.`
      });
    } catch (err) {
      res.json({
        success: true,
        connected: false,
        sheetId: targetId,
        error: err.message
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Service Status Check
app.get('/api/status', async (req, res) => {
  try {
    const email = await getClientEmail();
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const stored = await loadStoredArticles();

    let queueCount = 0;
    try {
      const qData = JSON.parse(await fs.readFile(QUEUE_PATH, 'utf8'));
      queueCount = Array.isArray(qData) ? qData.length : 0;
    } catch {}

    let sheetsConnected = false;
    let sheetsError = null;
    try {
      const sheets = await ensureSheet();
      sheetsConnected = Boolean(sheets);
    } catch (err) {
      sheetsError = err.message;
    }

    res.json({
      serviceAccount: email,
      sheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
      sheetsConnected,
      sheetsError,
      geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      minScore: Number(process.env.MIN_RELEVANCE_SCORE || 75),
      totalStored: stored.length,
      queueCount,
      isScanning
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  log('info', `Intelligence Web Dashboard active at http://localhost:${PORT}`);
});
