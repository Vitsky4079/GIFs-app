'use strict';

const LIMIT = 50;

// ── State ──────────────────────────────────────────────────────────────────
let currentQuery  = null; // null = trending
let currentOffset = 0;
let totalCount    = 0;
let isLoading     = false;
let activeTab     = 'giphy';
let localGifs     = []; // { name, path, displayUrl }
let favoritesMap  = new Map(); // id → gif object

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

// ── Preview modal ─────────────────────────────────────────────────────────
function openPreview(src, title, buttons) {
  previewImg.src = src;
  previewTitle.textContent = title;
  previewActions.innerHTML = '';
  buttons.forEach(({ label, primary, action }) => {
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (primary ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { action(); });
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

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = isError ? 'error' : '';
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ── Tab switching ──────────────────────────────────────────────────────────
mainTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    mainTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.getElementById('pane-' + activeTab).classList.add('active');
  });
});

// ── Settings ───────────────────────────────────────────────────────────────
function openSettings() {
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
  localStorage.setItem('giphy_api_key', giphyKeyInput.value.trim());
  settingsStatus.textContent = 'Saved!';
  settingsStatus.className = '';
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
  if (!searchInput.value.trim()) loadTrending();
}
settingsBtn.addEventListener('click', openSettings);
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
  if (!key) throw new Error('No GIPHY API key — open Settings (⚙) to add one.');
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

const scrollObserver = new IntersectionObserver((entries) => {
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
  currentQuery = null;
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
    showToast(err.message, true);
  } finally {
    isLoading = false;
  }
}

// ── Search input events ────────────────────────────────────────────────────
searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  clearTimeout(debounceTimer);
  if (q) runSearch(q); else loadTrending();
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (q) runSearch(q); else loadTrending();
  }
});

let debounceTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();
  debounceTimer = setTimeout(() => { if (q) runSearch(q); else loadTrending(); }, 400);
});

// ── GIPHY render helpers ───────────────────────────────────────────────────
function setStatus(text) { statusBar.textContent = text; }

function clearGrid() {
  // Remove all children except the sentinel
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

function sanitizeFilename(title) {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().substring(0, 60) || 'gif';
}

function appendCards(gifs) {
  resultsGrid.classList.remove('empty');
  gifs.forEach(gif => {
    resultsGrid.insertBefore(buildGiphyCard(gif), sentinel);
  });
}

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
      action: async () => {
        showToast('Downloading…');
        const r = await window.electronAPI.downloadFile(gif.gifUrl, base + '.gif');
        if (r.success) showToast('Saved: ' + r.filePath.split('\\').pop());
        else showToast('Download failed: ' + r.error, true);
      },
    },
    {
      label: 'Copy GIF', primary: false,
      action: async () => {
        showToast('Copying…');
        const r = await window.electronAPI.copyImageToClipboard(gif.gifUrl);
        if (r.success) showToast('Copied to clipboard!');
        else showToast('Copy failed: ' + r.error, true);
      },
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

// ── Local GIFs tab ─────────────────────────────────────────────────────────
// Load persisted GIFs from user-gifs folder on startup
async function loadUserGifs() {
  const stored = await window.electronAPI.listUserGifs();
  localGifs = stored.map(({ name, filePath }) => ({
    name,
    path: filePath,
    displayUrl: pathToUrl(filePath),
  }));
  renderLocalGrid();
}

browseBtn.addEventListener('click', async () => {
  const paths = await window.electronAPI.openGifDialog();
  if (paths.length) addLocalPaths(paths);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', e => {
  // Only remove if leaving the dropzone entirely (not entering a child)
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const paths = Array.from(e.dataTransfer.files)
    .filter(f => f.type === 'image/gif' || f.name.toLowerCase().endsWith('.gif'))
    .map(f => f.path);
  if (paths.length) addLocalPaths(paths);
});

function pathToUrl(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/');
}

async function addLocalPaths(paths) {
  for (const p of paths) {
    const r = await window.electronAPI.importGif(p);
    if (r.success) {
      // Avoid duplicates in current list
      if (!localGifs.find(g => g.path === r.filePath)) {
        localGifs.push({ name: r.name, path: r.filePath, displayUrl: pathToUrl(r.filePath) });
      }
    } else {
      showToast('Failed to import: ' + r.error, true);
    }
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
    img.src = gif.displayUrl;
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
        action: async () => {
          showToast('Copying…');
          const r = await window.electronAPI.copyLocalToClipboard(gif.path);
          if (r.success) showToast('Copied to clipboard!');
          else showToast('Copy failed: ' + r.error, true);
        },
      },
      {
        label: 'Remove', primary: false,
        action: async () => {
          await window.electronAPI.removeUserGif(gif.path);
          localGifs.splice(idx, 1);
          renderLocalGrid();
        },
      },
    ];

    thumbWrapper.addEventListener('click', () => openPreview(gif.displayUrl, gif.name, localButtons));

    localButtons.forEach(({ label, primary, action }) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn' + (primary ? ' primary' : '');
      btn.textContent = label;
      btn.addEventListener('click', action);
      actions.appendChild(btn);
    });

    card.appendChild(thumbWrapper);
    card.appendChild(titleEl);
    card.appendChild(actions);
    localGrid.appendChild(card);
  });
}

// ── Favorites ──────────────────────────────────────────────────────────────
async function loadFavorites() {
  const list = await window.electronAPI.listFavorites();
  favoritesMap = new Map(list.map(g => [g.id, g]));
  renderFavoritesGrid();
  // Refresh hearts on any visible GIPHY cards
  document.querySelectorAll('.heart-btn').forEach(btn => {
    btn.textContent = favoritesMap.has(btn.dataset.id) ? '♥' : '♡';
    btn.classList.toggle('active', favoritesMap.has(btn.dataset.id));
  });
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
        action: async () => {
          showToast('Downloading…');
          const r = await window.electronAPI.downloadFile(gif.gifUrl, base + '.gif');
          if (r.success) showToast('Saved: ' + r.filePath.split('\\').pop());
          else showToast('Download failed: ' + r.error, true);
        },
      },
      {
        label: 'Copy GIF', primary: false,
        action: async () => {
          showToast('Copying…');
          const r = await window.electronAPI.copyImageToClipboard(gif.gifUrl);
          if (r.success) showToast('Copied to clipboard!');
          else showToast('Copy failed: ' + r.error, true);
        },
      },
      {
        label: '♥ Remove', primary: false,
        action: async () => {
          await window.electronAPI.removeFavorite(gif.id);
          favoritesMap.delete(gif.id);
          renderFavoritesGrid();
          // Update heart on any visible GIPHY card
          const btn = document.querySelector(`.heart-btn[data-id="${gif.id}"]`);
          if (btn) { btn.textContent = '♡'; btn.classList.remove('active'); }
        },
      },
    ];

    const card = buildGiphyCard(gif, false); // false = no heart btn inside favorites grid
    // Replace actions with favorites-specific buttons
    const actions = card.querySelector('.gif-actions');
    actions.innerHTML = '';
    actions.classList.add('three-btns');
    favButtons.forEach(({ label, primary, action }) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn' + (primary ? ' primary' : '');
      btn.textContent = label;
      btn.addEventListener('click', action);
      actions.appendChild(btn);
    });
    // Update preview buttons too
    card.querySelector('.gif-thumb-wrapper').onclick = () => openPreview(gif.gifUrl, gif.title, favButtons);
    favoritesGrid.appendChild(card);
  });
}

async function toggleFavorite(gif, heartBtn) {
  if (favoritesMap.has(gif.id)) {
    await window.electronAPI.removeFavorite(gif.id);
    favoritesMap.delete(gif.id);
    heartBtn.textContent = '♡';
    heartBtn.classList.remove('active');
    // Remove from favorites grid if visible
    renderFavoritesGrid();
  } else {
    await window.electronAPI.addFavorite(gif);
    favoritesMap.set(gif.id, gif);
    heartBtn.textContent = '♥';
    heartBtn.classList.add('active');
    renderFavoritesGrid();
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
searchInput.focus();
loadTrending();
loadUserGifs();
loadFavorites();
