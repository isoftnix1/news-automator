import axios from 'axios';
import fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { cleanText, normalizeUrl, log } from './utils.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false });

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }

export async function loadConfig() {
  const keywords = JSON.parse(await fs.readFile(new URL('../config/keywords.json', import.meta.url), 'utf8'));
  const feeds = JSON.parse(await fs.readFile(new URL('../config/feeds.json', import.meta.url), 'utf8'));
  return { keywords, feeds };
}

function buildQueries(config) {
  const terms = (config.keywords?.categories || []).flatMap(c => c.keywords.map(k => ({ category: c.name, keyword: k })));
  const groups = [];
  for (let i = 0; i < terms.length; i += 4) groups.push(terms.slice(i, i + 4));
  return groups.slice(0, Number(process.env.MAX_QUERIES_PER_RUN || 12)).map(group => ({
    category: [...new Set(group.map(x => x.category))].join(', '),
    keywords: group.map(x => x.keyword),
    query: group.map(x => `"${x.keyword.replaceAll('"', '')}"`).join(' OR ')
  }));
}

async function searchGdelt(group) {
  if (process.env.GDELT_ENABLED === 'false') return [];
  const endpoint = process.env.GDELT_API_URL || 'https://api.gdeltproject.org/api/v2/doc/doc';
  try {
    const response = await axios.get(endpoint, {
      params: {
        query: `(${group.query})`,
        mode: 'ArtList',
        format: 'json',
        sort: 'DateDesc',
        maxrecords: Number(process.env.MAX_ARTICLES_PER_QUERY || 50),
        timespan: `${Number(process.env.LOOKBACK_HOURS || 72)}h`
      },
      timeout: 25000,
      headers: { 'User-Agent': 'KeywordNewsIntelligenceBot/1.0 (news research)' }
    });
    const articles = response.data?.articles || [];
    return articles.map(a => ({
      title: cleanText(a.title),
      url: normalizeUrl(a.url),
      source: cleanText(a.domain || a.source || 'GDELT indexed publisher'),
      publishedAt: a.seendate ? parseGdeltDate(a.seendate) : '',
      description: cleanText(a.socialimage ? '' : a.title),
      matchedKeywords: group.keywords,
      categoryHint: group.category,
      regionHint: inferRegion(a.domain || '', a.url || '')
    })).filter(a => a.title && a.url);
  } catch (error) {
    const status = error.response?.status;
    log('warn', `GDELT query skipped (${status || error.message}) for: ${group.keywords.slice(0, 2).join(', ')}...`);
    return [];
  }
}

function parseGdeltDate(value) {
  if (/^\d{14}$/.test(value)) return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}Z`;
  const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function inferRegion(domain, url) {
  const text = `${domain} ${url}`.toLowerCase();
  if (/\.in\b|india|indian|maharashtra|delhi|bengaluru|mumbai|gujarat/.test(text)) {
    return 'India';
  }
  return 'Worldwide / not determined';
}

async function searchGoogleNews(group, region = 'India') {
  if (process.env.GOOGLE_NEWS_ENABLED === 'false') return [];
  try {
    const lookbackDays = Math.max(1, Math.round(Number(process.env.LOOKBACK_HOURS || 72) / 24));
    const searchQuery = `(${group.query}) when:${lookbackDays}d`;
    const params = region === 'India'
      ? { q: searchQuery, hl: 'en-IN', gl: 'IN', ceid: 'IN:en' }
      : { q: searchQuery, hl: 'en-US', gl: 'US', ceid: 'US:en' };

    const endpoint = 'https://news.google.com/rss/search';
    const response = await axios.get(endpoint, {
      params,
      timeout: 15000,
      headers: { 'User-Agent': BROWSER_USER_AGENT }
    });

    const parsed = parser.parse(response.data);
    const items = asArray(parsed.rss?.channel?.item);
    return items.map(item => {
      let rawTitle = cleanText(item.title || '');
      const sourceObj = item.source;
      const sourceName = typeof sourceObj === 'object' ? sourceObj['#text'] : (sourceObj || '');
      const sourceUrl = typeof sourceObj === 'object' ? sourceObj['@_url'] : '';

      // Strip publisher suffix if present (e.g. "Headline - Saur Energy")
      if (sourceName && rawTitle.endsWith(` - ${sourceName}`)) {
        rawTitle = rawTitle.slice(0, -(sourceName.length + 3)).trim();
      }

      const link = item.link?.['#text'] || item.link || '';
      const pubDate = item.pubDate ? validDate(item.pubDate) : '';
      const desc = cleanText(item.description || '');

      return {
        title: rawTitle,
        url: normalizeUrl(String(link)),
        source: sourceName || (sourceUrl ? new URL(sourceUrl).hostname : 'Google News'),
        publishedAt: pubDate,
        description: desc,
        matchedKeywords: group.keywords,
        categoryHint: group.category,
        regionHint: region === 'India' ? 'India' : inferRegion(sourceUrl, link)
      };
    }).filter(a => a.title && a.url);
  } catch (error) {
    log('warn', `Google News search error (${region}): ${error.message}`);
    return [];
  }
}

async function searchRss(feedUrl) {
  try {
    const response = await axios.get(feedUrl, {
      timeout: 18000,
      responseType: 'text',
      headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }
    });
    const parsed = parser.parse(response.data);
    const root = parsed.rss?.channel || parsed.feed || parsed.RDF || {};
    const entries = asArray(root.item || root.entry || parsed['rdf:RDF']?.item);
    const hostname = new URL(feedUrl).hostname;
    return entries.map(item => {
      const linkValue = item.link?.['@_href'] || item.link?.['#text'] || item.link || item.guid?.['#text'] || item.guid || '';
      const title = cleanText(item.title?.['#text'] || item.title || '');
      const desc = cleanText(item.description || item.summary || item.content || '');
      const date = item.pubDate || item.published || item.updated || item['dc:date'] || '';
      return {
        title,
        url: normalizeUrl(String(linkValue)),
        source: hostname,
        publishedAt: validDate(date),
        description: desc.slice(0, 1800),
        matchedKeywords: [],
        categoryHint: '',
        regionHint: inferRegion(hostname, feedUrl)
      };
    }).filter(a => a.title && a.url);
  } catch (error) {
    log('warn', `RSS feed failed: ${feedUrl}: ${error.message}`);
    return [];
  }
}

function validDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export async function discoverArticles() {
  const config = await loadConfig();
  const queryGroups = buildQueries(config);
  const results = [];

  // 1. Google News RSS discovery (High reliability, fresh real-time indexed news)
  log('info', `Running Google News RSS queries for ${queryGroups.length} keyword groups...`);
  for (const group of queryGroups) {
    const indiaArticles = await searchGoogleNews(group, 'India');
    const globalArticles = await searchGoogleNews(group, 'Worldwide');
    results.push(...indiaArticles, ...globalArticles);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  log('info', `Google News returned ${results.length} candidate articles`);

  // 2. GDELT Doc API discovery (with fast circuit-breaker on rate limits)
  if (process.env.GDELT_ENABLED !== 'false') {
    let consecutiveErrors = 0;
    const gdeltCap = Math.min(queryGroups.length, 6);
    for (let i = 0; i < gdeltCap; i++) {
      if (consecutiveErrors >= 2) {
        log('info', 'GDELT rate-limited; skipping remaining GDELT calls for this cycle.');
        break;
      }
      const group = queryGroups[i];
      const found = await searchGdelt(group);
      if (found.length === 0) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0;
        results.push(...found);
        log('info', `GDELT returned ${found.length} articles (${group.keywords.slice(0, 2).join(', ')})`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 3. Curated Industry RSS feeds
  log('info', `Scanning ${config.feeds.length} curated industry RSS feeds...`);
  const feeds = await Promise.all(config.feeds.map(searchRss));
  results.push(...feeds.flat());

  // 4. Keyword Filtering & Lookback Window
  const keywordList = config.keywords.categories.flatMap(c => c.keywords.map(k => ({ category: c.name, keyword: k })));
  const windowMs = Number(process.env.LOOKBACK_HOURS || 72) * 3600 * 1000;
  const now = Date.now();

  const filtered = results.filter(a => {
    if (a.publishedAt) {
      const age = now - new Date(a.publishedAt).getTime();
      // Drop if older than lookback window or more than 1 hour in the future
      if (age > windowMs || age < -3600 * 1000) return false;
    }
    const haystack = `${a.title} ${a.description}`.toLowerCase();
    const matches = keywordList.filter(k => haystack.includes(k.keyword.toLowerCase()));
    a.matchedKeywords = [...new Set([...(a.matchedKeywords || []), ...matches.map(m => m.keyword)])];
    if (!a.categoryHint && matches.length) {
      a.categoryHint = [...new Set(matches.map(m => m.category))].join(', ');
    }
    // Must match either a configured keyword or have category hint
    return a.matchedKeywords.length > 0 || Boolean(a.categoryHint);
  });

  // 5. URL & Content Deduplication
  const unique = new Map();
  for (const a of filtered) {
    const key = a.url.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, a);
    } else {
      const existing = unique.get(key);
      existing.matchedKeywords = [...new Set([...existing.matchedKeywords, ...a.matchedKeywords])];
      if ((a.description || '').length > (existing.description || '').length) {
        existing.description = a.description;
      }
    }
  }

  log('info', `Discovered ${results.length} total; ${unique.size} unique keyword-matching candidates retained`);
  return [...unique.values()];
}
