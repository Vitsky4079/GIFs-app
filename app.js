'use strict';

const LIMIT = 50;
const DB_NAME = 'gif-search-db';
const DB_VERSION = 1;
const STORE_NAME = 'user-gifs';

// ── State ──────────────────────────────────────────────────────────────────
let db = null;
let currentQuery  = null;
let currentOffset = 0;
let totalCount    = 0;
let isLoading     = false;
let localGifs     = []; // { name, blob, url }
let favoritesMap  = new Map();

// ── DOM refs ───────────────────────────────────────────────────────────────
const searchInput     = document.getElementById('search-input');
const searchBtn       = document.getElementById('search-btn');
const statusBar       = document.getElementById('status-bar');
const resultsGrid     = document.getElementById('results-grid');
const localGrid       = document.getElementById('local-grid');
const localStatus     = document.getElementById('local-status');
const dropZone        = document.getElementById('drop-zone');
const browseBtn       = document.getElementById('browse-btn');
const fileInput       = document.getElementById('file-input');
const settingsBtn     = document.getElementById('settings-btn');
const settingsPanel   = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const closeSettings   = document.getElementById('close-settings-btn');
const giphyKeyInput   = document.getElementById('giphy-key-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatus  = document.getElementById('settings-status');
const toast           = document.getElementById('toast');
const mainTabs        = document.querySelectorAll('.main-tab');
const favoritesGrid   = document.getElementById('favorites-grid');
const favoritesStatus = document.getElementById('favorites-status');
const previewModal    = document.getElementById('preview-modal');
const previewOverlay  = document.getElementById('preview-overlay');
const previewClose    = document.getElementById('preview-close');
const previewImg      = document.getElementById('preview-img');
const previewTitle    = document.getElementById('preview-title');
const previewActions  = document.getElementById('preview-actions');

// ── IndexedDB ──────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(name) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(name);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Favorites (localStorage) ───────────────────────────────────────────────
function loadFavoritesFromStorage() {
  try {
    const data = JSON.parse(localStorage.getItem('gif-favorites') || '[]');
    favoritesMap = new Map(data.map(g => [g.id, g]));
  } catch {
    favoritesMap = new Map();
  }
}

function saveFavoritesToStorage() {
  localStorage.setItem('gif-favorites', JSON.stringify([...favoritesMap.values()]));
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = isError ? 'error' : '';
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ── Preview modal ──────────────────────────────────────────────────────────
function openPreview(src, title, buttons) {
  previewImg.src = src;
  previewTitle.textContent = title;
  previewActions.innerHTML = '';
  buttons.forEach(({ label, primary, action }) => {
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (primary ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', action);
    previewActions.appendChild(btn);
  });
  previewModal.classList.remove('hidden');
}

function closePreview() {
  previewModal.classList.add('hidden');
  previewImg.src = '';
}

previewClose.addEventListener('click', closePreview);
previewOverlay.addEventListener('click', closePreview);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

// ── Tab switching ──────────────────────────────────────────────────────────
mainTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    mainTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Settings ───────────────────────────────────────────────────────────────
function openSettingsPanel() {
  giphyKeyInput.value = localStorage.getItem('giphy_api_key') || '';
  settingsStatus.textContent = '';
  settingsPanel.classList.remove('hidden');
  settingsOverlay.classList.remove('hidden');
}
function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
  settingsOverlay.classList.add('hidden');
}
function saveSettings() {
  const key = giphyKeyInput.value.trim();
  localStorage.setItem('giphy_api_key', key);
  settingsStatus.textContent = 'Saved!';
  settingsStatus.className = '';
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
  closeSettingsPanel();
  if (!searchInput.value.trim()) loadTrending();
}

settingsBtn.addEventListener('click', openSettingsPanel);
closeSettings.addEventListener('click', closeSettingsPanel);
settingsOverlay.addEventListener('click', closeSettingsPanel);
saveSettingsBtn.addEventListener('click', saveSettings);

document.querySelectorAll('.show-key-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (input.type === 'password') { input.type = 'text'; btn.textContent = 'Hide'; }
    else { input.type = 'password'; btn.textContent = 'Show'; }
  });
});

// ── GIPHY API ──────────────────────────────────────────────────────────────
async function giphyFetch(endpoint, params) {
  const key = localStorage.getItem('giphy_api_key');
  if (!key) {
    openSettingsPanel();
    throw new Error('No GIPHY API key — add one in Settings (⚙).');
  }
  const qs = new URLSearchParams({ api_key: key, limit: LIMIT, rating: 'g', ...params });
  const res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${qs}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || `GIPHY error ${res.status}`);
  }
  return res.json();
}

function normalizeItems(data) {
  return data.map(item => ({
    id: item.id,
    title: item.title || 'GIF',
    thumbnailUrl: item.images.fixed_width.url,
    gifUrl: item.images.original.url,
    pageUrl: item.url,
  }));
}

// ── Infinite scroll sentinel ───────────────────────────────────────────────
const sentinel = document.createElement('div');
sentinel.id = 'scroll-sentinel';
resultsGrid.appendChild(sentinel);

const scrollObserver = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && !isLoading && currentOffset < totalCount) {
    if (currentQuery === null) loadMoreTrending();
    else runSearch(currentQuery, true);
  }
}, { root: resultsGrid, threshold: 0.1 });

scrollObserver.observe(sentinel);

// ── Load Trending ──────────────────────────────────────────────────────────
async function loadTrending() {
  if (isLoading) return;
  isLoading = true;
  currentQuery  = null;
  currentOffset = 0;
  setStatus('Loading trending GIFs…');
  clearGrid();
  try {
    const json = await giphyFetch('trending', { offset: 0 });
    totalCount    = json.pagination.total_count;
    currentOffset = json.data.length;
    appendCards(normalizeItems(json.data));
    setStatus(`Trending Now — ${currentOffset} GIFs loaded`);
  } catch (err) {
    showEmpty('⚠ ' + err.message);
    setStatus('');
  } finally {
    isLoading = false;
  }
}

async function loadMoreTrending() {
  if (isLoading) return;
  isLoading = true;
  try {
    const json = await giphyFetch('trending', { offset: currentOffset });
    totalCount    = json.pagination.total_count;
    currentOffset += json.data.length;
    appendCards(normalizeItems(json.data));
    setStatus(`Trending Now — ${currentOffset} GIFs loaded`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    isLoading = false;
  }
}

// ── Search ─────────────────────────────────────────────────────────────────
async function runSearch(query, append = false) {
  if (isLoading) return;
  isLoading = true;
  if (!append) {
    currentQuery  = query;
    currentOffset = 0;
    setStatus('Searching…');
    clearGrid();
  }
  try {
    const json = await giphyFetch('search', { q: query, offset: currentOffset });
    totalCount    = json.pagination.total_count;
    currentOffset += json.data.length;
    appendCards(normalizeItems(json.data));
    if (!append && json.data.length === 0) {
      showEmpty('No results for "' + query + '"');
      setStatus('No results found.');
    } else {
      setStatus(`Showing ${currentOffset.toLocaleString()} of ${totalCount.toLocaleString()} results for "${query}"`);
    }
  } catch (err) {
    setStatus('Error: ' + err.message);
    if (!append) showEmpty('⚠ ' + err.message);
    else showToast(err.message, true);
  } finally {
    isLoading = false;
  }
}

// ── Search input events ────────────────────────────────────────────────────
let debounceTimer = null;
searchBtn.addEventListener('click', () => {
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();
  if (q) runSearch(q); else loadTrending();
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (q) runSearch(q); else loadTrending();
  }
});
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();
  debounceTimer = setTimeout(() => { if (q) runSearch(q); else loadTrending(); }, 400);
});

// ── Grid helpers ───────────────────────────────────────────────────────────
function setStatus(text) { statusBar.textContent = text; }

function clearGrid() {
  while (resultsGrid.firstChild && resultsGrid.firstChild !== sentinel) {
    resultsGrid.removeChild(resultsGrid.firstChild);
  }
  resultsGrid.classList.remove('empty');
}

function showEmpty(message) {
  clearGrid();
  resultsGrid.classList.add('empty');
  const msg = document.createElement('span');
  msg.textContent = message;
  resultsGrid.insertBefore(msg, sentinel);
}

function appendCards(gifs) {
  resultsGrid.classList.remove('empty');
  gifs.forEach(gif => resultsGrid.insertBefore(buildGiphyCard(gif), sentinel));
}

function sanitizeFilename(title) {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().substring(0, 60) || 'gif';
}

// ── Download helper ────────────────────────────────────────────────────────
async function downloadGif(url, filename) {
  showToast('Downloading…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showToast('Download started!');
  } catch (err) {
    showToast('Download failed: ' + err.message, true);
  }
}

// ── Copy GIF helper ────────────────────────────────────────────────────────
async function copyGif(url) {
  showToast('Copying…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    // Try modern Clipboard API with image/gif
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/gif': blob })]);
      showToast('Copied to clipboard!');
    } else {
      // Fallback: download it instead
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gif.gif';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast('Clipboard not supported — downloaded instead.');
    }
  } catch (err) {
    showToast('Copy failed: ' + err.message, true);
  }
}

// ── Copy local GIF (from blob) ─────────────────────────────────────────────
async function copyLocalGif(blob) {
  showToast('Copying…');
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/gif': blob })]);
      showToast('Copied to clipboard!');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gif.gif';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast('Clipboard not supported — downloaded instead.');
    }
  } catch (err) {
    showToast('Copy failed: ' + err.message, true);
  }
}

// ── Build GIPHY card ───────────────────────────────────────────────────────
function buildGiphyCard(gif, showHeart = true) {
  const card = document.createElement('div');
  card.className = 'gif-card';

  const thumbWrapper = document.createElement('div');
  thumbWrapper.className = 'gif-thumb-wrapper';

  const img = document.createElement('img');
  img.className = 'gif-thumb';
  img.src = gif.thumbnailUrl;
  img.alt = gif.title;
  img.loading = 'lazy';
  img.onerror = () => { thumbWrapper.style.background = '#1c1c1c'; };
  thumbWrapper.appendChild(img);

  if (showHeart) {
    const heartBtn = document.createElement('button');
    heartBtn.className = 'heart-btn' + (favoritesMap.has(gif.id) ? ' active' : '');
    heartBtn.textContent = favoritesMap.has(gif.id) ? '♥' : '♡';
    heartBtn.dataset.id = gif.id;
    heartBtn.title = 'Add to Favorites';
    heartBtn.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(gif, heartBtn); });
    thumbWrapper.appendChild(heartBtn);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'gif-title';
  titleEl.textContent = gif.title;
  titleEl.title = gif.title;

  const actions = document.createElement('div');
  actions.className = 'gif-actions';
  const base = sanitizeFilename(gif.title);

  const giphyButtons = [
    {
      label: 'Download GIF', primary: true,
      action: () => downloadGif(gif.gifUrl, base + '.gif'),
    },
    {
      label: 'Copy GIF', primary: false,
      action: () => copyGif(gif.gifUrl),
    },
  ];

  thumbWrapper.addEventListener('click', () => openPreview(gif.gifUrl, gif.title, giphyButtons));

  giphyButtons.forEach(({ label, primary, action }) => {
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (primary ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', action);
    actions.appendChild(btn);
  });

  card.appendChild(thumbWrapper);
  card.appendChild(titleEl);
  card.appendChild(actions);
  return card;
}

// ── Favorites ──────────────────────────────────────────────────────────────
function toggleFavorite(gif, heartBtn) {
  if (favoritesMap.has(gif.id)) {
    favoritesMap.delete(gif.id);
    heartBtn.textContent = '♡';
    heartBtn.classList.remove('active');
  } else {
    favoritesMap.set(gif.id, gif);
    heartBtn.textContent = '♥';
    heartBtn.classList.add('active');
  }
  saveFavoritesToStorage();
  renderFavoritesGrid();
}

function renderFavoritesGrid() {
  favoritesGrid.innerHTML = '';
  const list = [...favoritesMap.values()];
  favoritesStatus.textContent = list.length ? `${list.length} saved GIF${list.length !== 1 ? 's' : ''}` : '';

  if (list.length === 0) {
    favoritesGrid.classList.add('empty');
    favoritesGrid.textContent = 'No favorites yet — click ♡ on any GIPHY GIF to save it here.';
    return;
  }
  favoritesGrid.classList.remove('empty');

  list.forEach(gif => {
    const base = sanitizeFilename(gif.title);
    const favButtons = [
      {
        label: 'Download GIF', primary: true,
        action: () => downloadGif(gif.gifUrl, base + '.gif'),
      },
      {
        label: 'Copy GIF', primary: false,
        action: () => copyGif(gif.gifUrl),
      },
      {
        label: '♥ Remove', primary: false,
        action: () => {
          favoritesMap.delete(gif.id);
          saveFavoritesToStorage();
          renderFavoritesGrid();
          // Update heart on any visible GIPHY card
          const btn = document.querySelector(`.heart-btn[data-id="${gif.id}"]`);
          if (btn) { btn.textContent = '♡'; btn.classList.remove('active'); }
        },
      },
    ];

    const card = buildGiphyCard(gif, false);
    const actionsEl = card.querySelector('.gif-actions');
    actionsEl.innerHTML = '';
    actionsEl.classList.add('three-btns');
    favButtons.forEach(({ label, primary, action }) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn' + (primary ? ' primary' : '');
      btn.textContent = label;
      btn.addEventListener('click', action);
      actionsEl.appendChild(btn);
    });
    card.querySelector('.gif-thumb-wrapper').onclick = () => openPreview(gif.gifUrl, gif.title, favButtons);
    favoritesGrid.appendChild(card);
  });
}

// ── My GIFs ────────────────────────────────────────────────────────────────
async function initLocalGifs() {
  const records = await dbGetAll();
  // Revoke any old object URLs
  localGifs.forEach(g => URL.revokeObjectURL(g.url));
  localGifs = records.map(r => ({
    name: r.name,
    blob: r.blob,
    url: URL.createObjectURL(r.blob),
  }));
  renderLocalGrid();
}

async function importFiles(files) {
  for (const file of files) {
    if (file.type !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif')) continue;
    // Deduplicate name
    let name = file.name;
    const existing = new Set(localGifs.map(g => g.name));
    if (existing.has(name)) {
      const base = name.replace(/\.gif$/i, '');
      let i = 1;
      while (existing.has(`${base}_${i}.gif`)) i++;
      name = `${base}_${i}.gif`;
    }
    const blob = file.slice(0, file.size, 'image/gif');
    await dbPut({ name, blob });
    localGifs.push({ name, blob, url: URL.createObjectURL(blob) });
  }
  renderLocalGrid();
}

function renderLocalGrid() {
  localGrid.innerHTML = '';
  const hint = document.getElementById('drop-hint');

  if (localGifs.length === 0) {
    hint.style.display = '';
    localStatus.textContent = '';
    return;
  }

  hint.style.display = 'none';
  localStatus.textContent = `${localGifs.length} GIF${localGifs.length !== 1 ? 's' : ''}`;

  localGifs.forEach((gif, idx) => {
    const card = document.createElement('div');
    card.className = 'gif-card';

    const thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'gif-thumb-wrapper';

    const img = document.createElement('img');
    img.className = 'gif-thumb';
    img.src = gif.url;
    img.alt = gif.name;
    thumbWrapper.appendChild(img);

    const titleEl = document.createElement('div');
    titleEl.className = 'gif-title';
    titleEl.textContent = gif.name;
    titleEl.title = gif.name;

    const actions = document.createElement('div');
    actions.className = 'gif-actions';

    const localButtons = [
      {
        label: 'Copy GIF', primary: true,
        action: () => copyLocalGif(gif.blob),
      },
      {
        label: 'Download', primary: false,
        action: () => {
          const a = document.createElement('a');
          a.href = gif.url;
          a.download = gif.name;
          a.click();
        },
      },
      {
        label: 'Remove', primary: false,
        action: async () => {
          await dbDelete(gif.name);
          URL.revokeObjectURL(gif.url);
          localGifs.splice(idx, 1);
          renderLocalGrid();
        },
      },
    ];

    thumbWrapper.addEventListener('click', () => openPreview(gif.url, gif.name, localButtons));

    localButtons.forEach(({ label, primary, action }) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn' + (primary ? ' primary' : '');
      btn.textContent = label;
      btn.addEventListener('click', action);
      actions.appendChild(btn);
    });

    // 3 buttons — primary takes full row
    actions.classList.add('three-btns');

    card.appendChild(thumbWrapper);
    card.appendChild(titleEl);
    card.appendChild(actions);
    localGrid.appendChild(card);
  });
}

// ── Browse button & file input ─────────────────────────────────────────────
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    importFiles(Array.from(fileInput.files));
    fileInput.value = '';
  }
});

// ── Drag & drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(
    f => f.type === 'image/gif' || f.name.toLowerCase().endsWith('.gif')
  );
  if (files.length) importFiles(files);
});

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  db = await openDB();
  loadFavoritesFromStorage();
  renderFavoritesGrid();
  await initLocalGifs();
  searchInput.focus();
  loadTrending();
}

init();
