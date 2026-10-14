export function cleanText(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

export function normalizeUrl(raw = '') {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, '');
  } catch { return String(raw).trim(); }
}

export function stableKey(article) {
  const url = normalizeUrl(article.url || '');
  if (url) return url.toLowerCase();
  return cleanText(article.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function log(level, ...args) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const configured = levels[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2;
  if ((levels[level] ?? 2) <= configured) console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}
