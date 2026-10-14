import { google } from 'googleapis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './utils.js';

export const HEADERS = [
  'Date',
  'Headline',
  'Category',
  'Company / Organizations',
  'AI Summary',
  'Key Development',
  'Deal / Investment Value',
  'Location',
  'Published Time (UTC)',
  'Publisher',
  'Article URL',
  'Relevance Score',
  'Development Type',
  'Matched Keywords',
  'AI Rationale',
  'Discovery Date (UTC)'
];

const COLUMN_WIDTHS = [
  { startIndex: 0, endIndex: 1, pixelSize: 95 },   // Date
  { startIndex: 1, endIndex: 2, pixelSize: 320 },  // Headline
  { startIndex: 2, endIndex: 3, pixelSize: 160 },  // Category
  { startIndex: 3, endIndex: 4, pixelSize: 190 },  // Company / Organizations
  { startIndex: 4, endIndex: 5, pixelSize: 420 },  // AI Summary
  { startIndex: 5, endIndex: 6, pixelSize: 300 },  // Key Development
  { startIndex: 6, endIndex: 7, pixelSize: 150 },  // Deal Value
  { startIndex: 7, endIndex: 8, pixelSize: 130 },  // Location
  { startIndex: 8, endIndex: 9, pixelSize: 160 },  // Published Time
  { startIndex: 9, endIndex: 10, pixelSize: 140 }, // Publisher
  { startIndex: 10, endIndex: 11, pixelSize: 200 },// URL
  { startIndex: 11, endIndex: 12, pixelSize: 95 }, // Score
  { startIndex: 12, endIndex: 13, pixelSize: 140 },// Development Type
  { startIndex: 13, endIndex: 14, pixelSize: 180 },// Keywords
  { startIndex: 14, endIndex: 15, pixelSize: 250 },// Rationale
  { startIndex: 15, endIndex: 16, pixelSize: 160 } // Discovery Date
];

const QUEUE_FILE = path.resolve(process.cwd(), 'data', 'offline_queue.json');

export async function getClientEmail() {
  try {
    const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './credentials.json';
    const content = await fs.readFile(credPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.client_email || 'Service Account';
  } catch {
    return 'Service Account';
  }
}

function printPermissionWarning(email, sheetId) {
  console.error('\n' + '='.repeat(82));
  console.error('[GOOGLE SHEETS PERMISSION REQUIRED]');
  console.error('The Google Sheets API rejected access ("The caller does not have permission").');
  console.error(`1. Open your Google Sheet in a browser:`);
  console.error(`   https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  console.error(`2. Click the "Share" button at the top right.`);
  console.error(`3. Add this service account email with "Editor" permissions:`);
  console.error(`   👉 ${email}`);
  console.error('4. Uncheck "Notify people" and click Save/Share.');
  console.error('='.repeat(82) + '\n');
}

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './credentials.json';
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

export const spreadsheetId = () => {
  if (!process.env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID is missing in .env');
  return process.env.GOOGLE_SHEET_ID;
};

const masterTab = () => (process.env.GOOGLE_SHEET_TAB || 'News').replaceAll("'", "''");
const cleanTab = (name) => String(name).replaceAll("'", "''");
const range = (tabName, cells) => `'${cleanTab(tabName)}'!${cells}`;

export function getArticleDate(article) {
  if (article.publishedAt) {
    const d = new Date(article.publishedAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

export async function ensureTab(sheets, title) {
  const id = spreadsheetId();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: id });
  let sheet = (metadata.data.sheets || []).find(s => s.properties?.title === title);

  if (!sheet) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    });
    sheet = addRes.data.replies?.[0]?.addSheet;
  }

  const sheetId = sheet?.properties?.sheetId;
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: range(title, 'A1:P1')
  }).catch(() => ({ data: { values: [] } }));

  if (!current.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: range(title, 'A1:P1'),
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] }
    });

    if (sheetId != null) {
      await formatSheet(sheets, id, sheetId);
    }
  }

  return { title, sheetId };
}

async function formatSheet(sheets, id, sheetId) {
  try {
    const requests = [
      // Freeze header row
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 1 }
          },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      // Header styling: Dark slate blue background, bold white text
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: HEADERS.length
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.12, green: 0.23, blue: 0.36 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
              wrapStrategy: 'WRAP',
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,horizontalAlignment,verticalAlignment)'
        }
      },
      // Set optimized column widths
      ...COLUMN_WIDTHS.map(col => ({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: col.startIndex,
            endIndex: col.endIndex
          },
          properties: { pixelSize: col.pixelSize },
          fields: 'pixelSize'
        }
      }))
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests }
    });
  } catch (err) {
    log('debug', `Header format non-critical warning: ${err.message}`);
  }
}

async function sortSheetByDate(sheets, id, sheetId) {
  if (sheetId == null) return;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: {
                sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: HEADERS.length
              },
              sortSpecs: [
                { dimensionIndex: 0, sortOrder: 'DESCENDING' }, // Date
                { dimensionIndex: 8, sortOrder: 'DESCENDING' }  // Published Time
              ]
            }
          }
        ]
      }
    });
  } catch {
    // Sorting failure is non-fatal
  }
}

export async function ensureSheet() {
  try {
    const sheets = await getSheetsClient();
    await ensureTab(sheets, masterTab());
    return sheets;
  } catch (error) {
    const email = await getClientEmail();
    const id = process.env.GOOGLE_SHEET_ID;
    if (error.code === 403 || error.message?.includes('caller does not have permission')) {
      printPermissionWarning(email, id);
    }
    throw error;
  }
}

export async function readExistingUrls(sheets) {
  const id = spreadsheetId();
  try {
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: id });
    const titles = (metadata.data.sheets || []).map(s => s.properties?.title).filter(Boolean);
    const existing = new Set();

    for (const title of titles) {
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: range(title, '1:1')
      }).catch(() => null);

      const headers = headerRes?.data?.values?.[0] || [];
      const urlColIdx = headers.findIndex(h => String(h).toLowerCase().includes('url'));
      if (urlColIdx === -1) continue;

      const colLetter = String.fromCharCode(65 + urlColIdx);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: range(title, `${colLetter}2:${colLetter}`)
      }).catch(() => null);

      for (const val of (res?.data?.values || []).flat()) {
        if (val) existing.add(String(val).trim().toLowerCase());
      }
    }
    return existing;
  } catch (error) {
    log('warn', `Could not read existing URLs from sheets: ${error.message}`);
    return new Set();
  }
}

function formatArticleRow(a, e) {
  const dateStr = getArticleDate(a);
  return [
    dateStr,
    a.title || '',
    e.category || '',
    e.companies || '',
    e.summary || '',
    e.keyDevelopment || '',
    e.dealValue || '',
    e.location || '',
    a.publishedAt || '',
    a.source || '',
    a.url || '',
    e.score ?? 0,
    e.developmentType || '',
    (a.matchedKeywords || []).join(', '),
    e.reason || '',
    new Date().toISOString()
  ];
}

export async function saveToOfflineQueue(items) {
  if (!items.length) return;
  try {
    await fs.mkdir(path.dirname(QUEUE_FILE), { recursive: true });
    let existing = [];
    try {
      const content = await fs.readFile(QUEUE_FILE, 'utf8');
      existing = JSON.parse(content);
    } catch {}
    const combined = [...existing, ...items];
    await fs.writeFile(QUEUE_FILE, JSON.stringify(combined, null, 2), 'utf8');
    log('info', `Saved ${items.length} items to offline queue (${QUEUE_FILE}) for later sync.`);
  } catch (err) {
    log('error', `Failed to write offline queue: ${err.message}`);
  }
}

export async function flushOfflineQueue(sheets) {
  try {
    const content = await fs.readFile(QUEUE_FILE, 'utf8');
    const items = JSON.parse(content);
    if (Array.isArray(items) && items.length > 0) {
      log('info', `Flushing ${items.length} queued items from offline storage to Google Sheets...`);
      await appendArticlesDirect(sheets, items);
      await fs.writeFile(QUEUE_FILE, '[]', 'utf8');
      log('info', `Successfully synced offline items to Google Sheets!`);
    }
  } catch (err) {
    // No queue file or empty
  }
}

async function appendArticlesDirect(sheets, items) {
  if (!items.length) return 0;
  const id = spreadsheetId();
  const mode = (process.env.SHEET_DATE_MODE || 'both').toLowerCase();

  const byDate = new Map();
  for (const item of items) {
    const d = getArticleDate(item.article);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(item);
  }

  // 1. Append to Master Tab
  if (mode === 'both' || mode === 'sheet') {
    const masterInfo = await ensureTab(sheets, masterTab());
    const masterValues = items.map(({ article: a, evaluation: e }) => formatArticleRow(a, e));
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: range(masterTab(), 'A:P'),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: masterValues }
    });
    await sortSheetByDate(sheets, id, masterInfo.sheetId);
    log('info', `Appended ${masterValues.length} rows to master tab '${masterTab()}'`);
  }

  // 2. Append to Date-Wise Tabs
  if (mode === 'both' || mode === 'tabs') {
    for (const [dateStr, dateItems] of byDate.entries()) {
      const dateTabInfo = await ensureTab(sheets, dateStr);
      const dateValues = dateItems.map(({ article: a, evaluation: e }) => formatArticleRow(a, e));
      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: range(dateStr, 'A:P'),
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: dateValues }
      });
      await sortSheetByDate(sheets, id, dateTabInfo.sheetId);
      log('info', `Appended ${dateValues.length} rows to date tab '${dateStr}'`);
    }
  }

  return items.length;
}

export async function appendArticles(sheets, items) {
  if (!items.length) return 0;
  try {
    // Flush any pending items from offline queue first
    await flushOfflineQueue(sheets);
    return await appendArticlesDirect(sheets, items);
  } catch (error) {
    log('error', `Failed to append articles to Google Sheets: ${error.message}`);
    await saveToOfflineQueue(items);
    throw error;
  }
}
