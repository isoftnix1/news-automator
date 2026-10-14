// --- State ---
let state = {
  config: { categories: [], regions: [] },
  articles: [],
  status: {},
  activeCategoryTab: 'All',
  feedCategory: 'All',
  searchQuery: ''
};

// --- Elements ---
const el = {
  sheetDot: document.getElementById('sheetDot'),
  sheetStatusText: document.getElementById('sheetStatusText'),
  sheetLink: document.getElementById('sheetLink'),
  sheetsStatus: document.getElementById('sheetsStatus'),
  syncBtn: document.getElementById('syncBtn'),
  queueCount: document.getElementById('queueCount'),
  scanBtn: document.getElementById('scanBtn'),
  loadingBanner: document.getElementById('loadingBanner'),
  loadingText: document.getElementById('loadingText'),

  categoryTabs: document.getElementById('categoryTabs'),
  keywordsTags: document.getElementById('keywordsTags'),
  addKeywordForm: document.getElementById('addKeywordForm'),
  addKeywordCategory: document.getElementById('addKeywordCategory'),
  newKeywordInput: document.getElementById('newKeywordInput'),
  newCategoryBtn: document.getElementById('newCategoryBtn'),
  resetKeywordsBtn: document.getElementById('resetKeywordsBtn'),

  searchInput: document.getElementById('searchInput'),
  feedCategorySelect: document.getElementById('feedCategorySelect'),
  refreshBtn: document.getElementById('refreshBtn'),
  resultsCount: document.getElementById('resultsCount'),
  articlesList: document.getElementById('articlesList'),

  sheetModal: document.getElementById('sheetModal'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  doneModalBtn: document.getElementById('doneModalBtn'),
  targetSheetUrlInput: document.getElementById('targetSheetUrlInput'),
  saveSheetUrlBtn: document.getElementById('saveSheetUrlBtn'),
  serviceEmailInput: document.getElementById('serviceEmailInput'),
  copyEmailBtn: document.getElementById('copyEmailBtn'),
  modalSheetLink: document.getElementById('modalSheetLink'),
  modalAlert: document.getElementById('modalAlert'),
  verifySheetBtn: document.getElementById('verifySheetBtn'),

  toast: document.getElementById('toast')
};

// --- Toast ---
function showToast(text) {
  el.toast.textContent = text;
  el.toast.style.display = 'block';
  setTimeout(() => {
    el.toast.style.display = 'none';
  }, 3500);
}

// --- Status API ---
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.status = data;

    el.queueCount.textContent = data.queueCount || 0;

    if (data.sheetsConnected) {
      el.sheetDot.className = 'status-dot online';
      el.sheetStatusText.textContent = 'Sheet: Connected';
      el.sheetLink.style.display = 'inline';
      el.sheetLink.href = data.sheetUrl;
    } else {
      el.sheetDot.className = 'status-dot warning';
      el.sheetStatusText.textContent = 'Sheet: Click to Setup';
      el.sheetLink.style.display = 'none';
    }

    el.serviceEmailInput.value = data.serviceAccount || '';
    el.modalSheetLink.href = data.sheetUrl || '#';
  } catch (err) {
    console.warn('Status error:', err.message);
  }
}

// --- Keywords API ---
async function fetchKeywords() {
  try {
    const res = await fetch('/api/keywords');
    const data = await res.json();
    state.config = data;
    renderCategoryTabs();
    renderKeywordsTags();
    updateCategoryDropdowns();
  } catch (err) {
    showToast('Could not load keywords: ' + err.message);
  }
}

async function saveKeywords() {
  try {
    const res = await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.config)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Keywords updated');
      updateCategoryDropdowns();
    }
  } catch (err) {
    showToast('Failed to save keywords');
  }
}

function promptNewCategory() {
  const catName = window.prompt('Enter new category name (e.g. Agriculture, Aerospace, Solar):');
  if (!catName || !catName.trim()) return;
  const clean = catName.trim();
  const exists = (state.config.categories || []).some(c => c.name.toLowerCase() === clean.toLowerCase());
  if (exists) {
    showToast(`Category "${clean}" already exists`);
    state.activeCategoryTab = (state.config.categories || []).find(c => c.name.toLowerCase() === clean.toLowerCase()).name;
    renderCategoryTabs();
    renderKeywordsTags();
    updateCategoryDropdowns();
    return;
  }
  state.config.categories.push({ name: clean, keywords: [] });
  state.activeCategoryTab = clean;
  renderCategoryTabs();
  renderKeywordsTags();
  updateCategoryDropdowns();
  saveKeywords();
  showToast(`Category "${clean}" created! Now add keywords to it.`);
}

function deleteCurrentCategory() {
  if (state.activeCategoryTab === 'All') return;
  const cat = state.activeCategoryTab;
  if (confirm(`Delete the "${cat}" category and all its keywords?`)) {
    state.config.categories = (state.config.categories || []).filter(c => c.name !== cat);
    state.activeCategoryTab = 'All';
    renderCategoryTabs();
    renderKeywordsTags();
    updateCategoryDropdowns();
    saveKeywords();
    showToast(`Category "${cat}" removed`);
  }
}

function renderCategoryTabs() {
  const container = el.categoryTabs;
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `cat-tab ${state.activeCategoryTab === 'All' ? 'active' : ''}`;
  allBtn.textContent = 'All Keywords';
  allBtn.addEventListener('click', () => {
    state.activeCategoryTab = 'All';
    renderCategoryTabs();
    renderKeywordsTags();
  });
  container.appendChild(allBtn);

  (state.config.categories || []).forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-tab ${state.activeCategoryTab === cat.name ? 'active' : ''}`;
    btn.textContent = `${cat.name} (${cat.keywords.length})`;
    btn.addEventListener('click', () => {
      state.activeCategoryTab = cat.name;
      renderCategoryTabs();
      renderKeywordsTags();
    });
    container.appendChild(btn);
  });

  const addTab = document.createElement('button');
  addTab.className = 'cat-tab';
  addTab.style.border = '1px dashed var(--border)';
  addTab.style.color = 'var(--text-muted)';
  addTab.textContent = '+ New Category';
  addTab.title = 'Create a new category';
  addTab.addEventListener('click', promptNewCategory);
  container.appendChild(addTab);
}

function renderKeywordsTags() {
  const container = el.keywordsTags;
  container.innerHTML = '';

  let keywordsToShow = [];
  if (state.activeCategoryTab === 'All') {
    (state.config.categories || []).forEach(c => {
      c.keywords.forEach(kw => {
        keywordsToShow.push({ category: c.name, keyword: kw });
      });
    });
  } else {
    const cat = (state.config.categories || []).find(c => c.name === state.activeCategoryTab);
    if (cat) {
      cat.keywords.forEach(kw => {
        keywordsToShow.push({ category: cat.name, keyword: kw });
      });
    }
  }

  keywordsToShow.forEach(({ category, keyword }) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `
      <span>${escapeHtml(keyword)}</span>
      <button class="remove-x" title="Delete keyword">&times;</button>
    `;

    // Remove keyword
    pill.querySelector('.remove-x').addEventListener('click', (e) => {
      e.stopPropagation();
      const catObj = (state.config.categories || []).find(c => c.name === category);
      if (catObj) {
        catObj.keywords = catObj.keywords.filter(k => k !== keyword);
        renderCategoryTabs();
        renderKeywordsTags();
        saveKeywords();
      }
    });

    container.appendChild(pill);
  });

  if (keywordsToShow.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">No keywords in this category. Type a keyword below to add.</span>';
  }

  if (state.activeCategoryTab !== 'All') {
    const delWrap = document.createElement('div');
    delWrap.style.width = '100%';
    delWrap.style.marginTop = '6px';
    delWrap.innerHTML = `<button type="button" class="btn-text" style="color: #EF4444; font-size: 0.76rem; cursor: pointer; text-decoration: underline;">Delete "${escapeHtml(state.activeCategoryTab)}" Category</button>`;
    delWrap.querySelector('button').addEventListener('click', deleteCurrentCategory);
    container.appendChild(delWrap);
  }
}

function updateCategoryDropdowns() {
  // Update add keyword select
  el.addKeywordCategory.innerHTML = '';
  (state.config.categories || []).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    if (state.activeCategoryTab !== 'All' && cat.name === state.activeCategoryTab) {
      opt.selected = true;
    }
    el.addKeywordCategory.appendChild(opt);
  });

  // Update feed filter select
  const current = el.feedCategorySelect.value;
  el.feedCategorySelect.innerHTML = '<option value="All">All Categories</option>';
  (state.config.categories || []).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    if (cat.name === current) opt.selected = true;
    el.feedCategorySelect.appendChild(opt);
  });
}

// --- Articles API ---
async function fetchArticles() {
  try {
    const params = new URLSearchParams();
    if (state.feedCategory && state.feedCategory !== 'All') {
      params.append('category', state.feedCategory);
    }
    if (state.searchQuery) {
      params.append('q', state.searchQuery);
    }
    params.append('minScore', '75');

    const res = await fetch(`/api/articles?${params.toString()}`);
    const data = await res.json();
    state.articles = data.articles || [];
    renderArticles();
  } catch (err) {
    showToast('Failed to load articles');
  }
}

function renderArticles() {
  const container = el.articlesList;
  container.innerHTML = '';

  const total = state.articles.length;
  el.resultsCount.textContent = `Showing ${total} article${total === 1 ? '' : 's'}`;

  if (total === 0) {
    container.innerHTML = `
      <div class="empty-msg">
        <p>No articles found matching the current search or filters.</p>
        <p style="margin-top: 6px;"><button id="emptyScanBtn" class="btn btn-secondary" style="margin: 8px auto;">Find Latest News</button></p>
      </div>
    `;
    const btn = document.getElementById('emptyScanBtn');
    if (btn) btn.addEventListener('click', triggerScan);
    return;
  }

  state.articles.forEach(item => {
    const a = item.article || item;
    const e = item.evaluation || {};

    const row = document.createElement('div');
    row.className = 'article-item';

    const sourceName = a.source || 'News Source';
    const timeAgo = formatTimeAgo(a.publishedAt);
    const category = e.category || a.categoryHint || 'Industry News';
    const dealValue = e.dealValue && e.dealValue !== 'Not reported' ? e.dealValue : null;
    const location = e.location && e.location !== 'Not reported' ? e.location : null;
    const companies = e.companies && e.companies !== 'Unknown' ? e.companies : null;

    row.innerHTML = `
      <h3 class="article-headline">
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
      </h3>

      <div class="article-byline">
        <span class="article-source">${escapeHtml(sourceName)}</span>
        <span>•</span>
        <span>${escapeHtml(timeAgo)}</span>
      </div>

      <p class="article-desc">${escapeHtml(e.summary || a.description || '')}</p>

      <div class="article-key-info">
        <span class="info-chip category">${escapeHtml(category)}</span>
        ${dealValue ? `<span class="info-chip deal">Value: ${escapeHtml(dealValue)}</span>` : ''}
        ${location ? `<span class="info-chip">Location: ${escapeHtml(location)}</span>` : ''}
        ${companies ? `<span class="info-chip">Company: ${escapeHtml(companies)}</span>` : ''}
      </div>

      <div class="article-actions-row">
        <span></span>
        <button class="btn btn-outline save-sheet-btn">Save to Sheet</button>
      </div>
    `;

    // Save to Sheet handler
    const saveBtn = row.querySelector('.save-sheet-btn');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const res = await fetch('/api/articles/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item })
        });
        const resData = await res.json();
        if (resData.success) {
          saveBtn.textContent = '✓ Saved in Sheet';
          saveBtn.style.color = 'var(--success)';
          saveBtn.style.borderColor = 'var(--success)';
          showToast('Article saved to Google Sheet');
        } else {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save to Sheet';
          showToast(resData.error || 'Failed to save');
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save to Sheet';
        showToast('Error saving to sheet');
      }
    });

    container.appendChild(row);
  });
}

// --- Scan & Sync ---
async function triggerScan() {
  el.scanBtn.disabled = true;
  el.loadingBanner.style.display = 'flex';

  let scanCategory = null;
  if (state.feedCategory && state.feedCategory !== 'All') {
    scanCategory = state.feedCategory;
  } else if (state.activeCategoryTab && state.activeCategoryTab !== 'All') {
    scanCategory = state.activeCategoryTab;
  }

  el.loadingText.textContent = scanCategory 
    ? `Searching latest news for ${scanCategory}...` 
    : 'Searching latest news for configured keywords...';

  try {
    const payload = { maxEvals: 20 };
    if (scanCategory) payload.category = scanCategory;

    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Scan complete: Evaluated ${data.evaluatedCount} news items`);
      await fetchArticles();
      await fetchStatus();
    } else {
      showToast('Scan error: ' + (data.error || ''));
    }
  } catch (err) {
    showToast('Failed to complete scan');
  } finally {
    el.scanBtn.disabled = false;
    el.loadingBanner.style.display = 'none';
  }
}

async function triggerSync() {
  el.syncBtn.disabled = true;
  el.syncBtn.textContent = 'Syncing...';
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Offline articles synced to Google Sheet');
      await fetchStatus();
    } else {
      showToast(data.error || 'Sync failed');
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message);
  } finally {
    el.syncBtn.disabled = false;
    el.syncBtn.textContent = `Sync to Sheet (${state.status.queueCount || 0})`;
  }
}

// --- Helpers ---
function formatTimeAgo(dateStr) {
  if (!dateStr) return 'Recently';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'Recently';
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Events ---
function setupEvents() {
  // Add Keyword
  el.addKeywordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const catName = el.addKeywordCategory.value;
    const kw = el.newKeywordInput.value.trim();
    if (!kw) return;

    const catObj = (state.config.categories || []).find(c => c.name === catName);
    if (catObj && !catObj.keywords.includes(kw)) {
      catObj.keywords.push(kw);
      el.newKeywordInput.value = '';
      renderCategoryTabs();
      renderKeywordsTags();
      saveKeywords();
    }
  });

  // Add Category Button
  if (el.newCategoryBtn) {
    el.newCategoryBtn.addEventListener('click', promptNewCategory);
  }

  // Reset Keywords
  el.resetKeywordsBtn.addEventListener('click', async () => {
    if (confirm('Reset keywords back to default settings?')) {
      try {
        const res = await fetch('/api/keywords/reset', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          state.config = data.config;
          renderCategoryTabs();
          renderKeywordsTags();
          updateCategoryDropdowns();
          showToast('Keywords reset to defaults');
        }
      } catch {
        showToast('Reset failed');
      }
    }
  });

  // Feed Filters
  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    fetchArticles();
  });

  el.feedCategorySelect.addEventListener('change', (e) => {
    state.feedCategory = e.target.value;
    fetchArticles();
  });

  el.refreshBtn.addEventListener('click', fetchArticles);

  // Scan & Sync
  el.scanBtn.addEventListener('click', triggerScan);
  el.syncBtn.addEventListener('click', triggerSync);

  // Sheets Modal
  el.sheetsStatus.addEventListener('click', () => {
    el.targetSheetUrlInput.value = state.status.sheetUrl || '';
    el.sheetModal.style.display = 'flex';
  });

  const closeModal = () => { el.sheetModal.style.display = 'none'; };
  el.closeModalBtn.addEventListener('click', closeModal);
  el.doneModalBtn.addEventListener('click', closeModal);

  el.copyEmailBtn.addEventListener('click', () => {
    el.serviceEmailInput.select();
    navigator.clipboard.writeText(el.serviceEmailInput.value);
    el.copyEmailBtn.textContent = 'Copied';
    setTimeout(() => { el.copyEmailBtn.textContent = 'Copy'; }, 2000);
    showToast('Service account email copied');
  });

  // Save / Update Sheet URL
  const updateSheetConfig = async () => {
    const url = el.targetSheetUrlInput.value.trim();
    if (!url) {
      showToast('Please enter a Google Sheet URL or ID');
      return;
    }
    el.verifySheetBtn.disabled = true;
    el.verifySheetBtn.textContent = 'Connecting & Syncing...';
    el.saveSheetUrlBtn.disabled = true;
    el.modalAlert.style.display = 'none';

    try {
      const res = await fetch('/api/sheet/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl: url })
      });
      const data = await res.json();
      await fetchStatus();

      if (data.connected) {
        el.modalAlert.style.display = 'block';
        el.modalAlert.style.background = '#DCFCE7';
        el.modalAlert.style.color = '#15803D';
        el.modalAlert.textContent = `✓ Connected! ${data.syncedCount || 0} articles have been saved into your Google Sheet.`;
        showToast('Google Sheet connected and synced!');
      } else {
        el.modalAlert.style.display = 'block';
        el.modalAlert.style.background = '#FEE2E2';
        el.modalAlert.style.color = '#B91C1C';
        el.modalAlert.textContent = `Access Denied: Please open the sheet, click Share, and add ${el.serviceEmailInput.value} as Editor.`;
        showToast('Permission needed: share sheet with service account');
      }
    } catch (err) {
      showToast('Error updating sheet: ' + err.message);
    } finally {
      el.verifySheetBtn.disabled = false;
      el.verifySheetBtn.textContent = 'Verify & Sync All News';
      el.saveSheetUrlBtn.disabled = false;
    }
  };

  el.saveSheetUrlBtn.addEventListener('click', updateSheetConfig);
  el.verifySheetBtn.addEventListener('click', updateSheetConfig);
}

// --- Init ---
async function init() {
  setupEvents();
  await Promise.all([fetchStatus(), fetchKeywords(), fetchArticles()]);
  setInterval(fetchStatus, 30000);
}

document.addEventListener('DOMContentLoaded', init);
