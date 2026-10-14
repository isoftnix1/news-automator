import fs from 'node:fs/promises';
import path from 'node:path';
import { log, stableKey } from './utils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'articles_store.json');

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadStoredArticles() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveStoredArticles(articles) {
  await ensureDataDir();
  try {
    await fs.writeFile(STORE_FILE, JSON.stringify(articles, null, 2), 'utf8');
  } catch (err) {
    log('error', `Failed to save articles to store: ${err.message}`);
  }
}

export async function upsertStoredArticles(newItems) {
  const existing = await loadStoredArticles();
  const map = new Map();

  for (const item of existing) {
    const key = stableKey(item.article || item).toLowerCase();
    map.set(key, item);
  }

  for (const item of newItems) {
    const key = stableKey(item.article || item).toLowerCase();
    map.set(key, item);
  }

  const merged = [...map.values()];
  // Sort descending by date
  merged.sort((a, b) => {
    const dateA = new Date(a.article?.publishedAt || a.publishedAt || 0).getTime();
    const dateB = new Date(b.article?.publishedAt || b.publishedAt || 0).getTime();
    return dateB - dateA;
  });

  await saveStoredArticles(merged);
  return merged;
}
