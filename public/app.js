// ── API Helper ───────────────────────────────────────────
const api = {
  async get(url) { const r = await fetch(url); return r.json(); },
  async post(url, data) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return r.json(); },
  async streamPost(url, data, onMessage, signal) {
    const r = await fetch(url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data),
      signal
    });
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer && buffer.trim()) {
            try { onMessage(JSON.parse(buffer)); } catch(e) {}
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the last incomplete line
        for (const line of lines) {
          if (line.trim()) {
            try { onMessage(JSON.parse(line)); } catch(e) {}
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted');
        onMessage({ type: 'complete', message: 'Scraping stopped by user', stopped: true });
      } else {
        throw err;
      }
    } finally {
      reader.releaseLock();
    }
  },
  async put(url, data) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return r.json(); },
  async del(url) { const r = await fetch(url, { method: 'DELETE' }); return r.json(); }
};

// ── State ────────────────────────────────────────────────
let selectedGalleries = new Set();
let allGalleries = [];
let currentPage = 1;
let scrapeAbortController = null;
const ITEMS_PER_PAGE = 50;

// ── Navigation ───────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    if (view === 'dashboard') loadDashboard();
    if (view === 'galleries') loadGalleries();
    if (view === 'search') loadConfig();
    if (view === 'templates') loadTemplates();
    if (view === 'sendlog') loadSendLog();
  });
});

// ── Toast ────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Modal ────────────────────────────────────────────────
function openModal(title, bodyHTML, footerHTML = '') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalFooter').innerHTML = footerHTML;
  document.getElementById('modalOverlay').classList.add('active');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

// ── Dashboard ────────────────────────────────────────────
async function loadDashboard() {
  try {
    const stats = await api.get('/api/galleries/stats');
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statWithEmail').textContent = stats.withEmail;
    document.getElementById('statSent').textContent = stats.totalSent;
    document.getElementById('statToday').textContent = stats.sentToday;
    document.getElementById('statOpenRate').textContent = stats.openRate + '%';
    document.getElementById('statOpened').textContent = stats.totalOpened;

    // City chart and filter
    const cityChart = document.getElementById('cityChart');
    const cityKeys = Object.keys(stats.byCity || {}).sort();
    const filterCity = document.getElementById('filterCity');
    const currentCity = filterCity.value;
    filterCity.innerHTML = '<option value="">All Cities</option>' + 
      cityKeys.map(c => `<option value="${esc(c)}" ${c === currentCity ? 'selected' : ''}>${esc(c)}</option>`).join('');

    const cities = Object.entries(stats.byCity || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const maxCity = cities.length > 0 ? cities[0][1] : 1;
    cityChart.innerHTML = cities.map(([city, count]) => `
      <div class="bar-row">
        <span class="bar-label">${esc(city)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / maxCity) * 100}%">${count}</div></div>
      </div>`).join('') || '<p class="text-muted">No data yet. Use Search to find galleries.</p>';

    // Status chart
    const statusChart = document.getElementById('statusChart');
    const statuses = Object.entries(stats.byStatus || {});
    statusChart.innerHTML = statuses.map(([status, count]) => `
      <div class="status-row"><span class="label">${esc(status)}</span><span class="count">${count}</span></div>
    `).join('') || '<p class="text-muted">No galleries yet.</p>';
  } catch (err) { toast('Failed to load dashboard', 'error'); }
}

// ── Galleries ────────────────────────────────────────────
async function loadGalleries(resetPage = false) {
  if (resetPage) currentPage = 1;
  const params = new URLSearchParams();
  const search = document.getElementById('gallerySearch').value;
  const city = document.getElementById('filterCity').value;
  const status = document.getElementById('filterStatus').value;
  const hasEmail = document.getElementById('filterEmail').value;
  if (search) params.set('search', search);
  if (city) params.set('city', city);
  if (status) params.set('status', status);
  if (hasEmail) params.set('hasEmail', hasEmail);
  
  params.set('page', currentPage);
  params.set('limit', ITEMS_PER_PAGE);

  try {
    const data = await api.get(`/api/galleries?${params}`);
    allGalleries = data.galleries;
    renderGalleries(allGalleries);
    renderPagination(data.page, data.totalPages, data.total);
  } catch (err) { toast('Failed to load galleries', 'error'); }
}

function renderPagination(page, totalPages, totalItems) {
  const container = document.getElementById('paginationControls');
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = `<span class="text-muted" style="margin-right:10px;">Total: ${totalItems}</span>`;
  html += `<button class="btn btn-sm btn-outline" ${page <= 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">Prev</button>`;
  
  let startPage = Math.max(1, page - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

  if (startPage > 1) {
    html += `<button class="btn btn-sm btn-outline" onclick="changePage(1)">1</button>`;
    if (startPage > 2) html += `<span class="text-muted">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${i === page ? 'btn-primary' : 'btn-outline'}" onclick="changePage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="text-muted">...</span>`;
    html += `<button class="btn btn-sm btn-outline" onclick="changePage(${totalPages})">${totalPages}</button>`;
  }
  
  html += `<button class="btn btn-sm btn-outline" ${page >= totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Next</button>`;
  container.innerHTML = html;
}

window.changePage = function(newPage) {
  currentPage = newPage;
  loadGalleries();
}

function renderGalleries(galleries) {
  const tbody = document.getElementById('galleriesBody');
  tbody.innerHTML = galleries.map(g => `
    <tr data-id="${g.id}">
      <td><input type="checkbox" class="gallery-check" data-id="${g.id}" ${selectedGalleries.has(g.id) ? 'checked' : ''}></td>
      <td><strong>${esc(g.name)}</strong></td>
      <td>${esc(g.city)}</td>
      <td>${websiteCell(g.website)}</td>
      <td>${g.emails && g.emails.length > 0 ? g.emails.map(e => `<span style="color:var(--success)">${esc(e)}</span>`).join('<br>') : '<span class="text-muted">—</span>'}</td>
      <td>
        ${statusBadge(g.status)}
        ${g.open_count > 0 ? `<br><span class="badge" style="background:var(--accent);margin-top:4px;" title="Latest: ${new Date(g.latest_open).toLocaleString()}">Opened (${g.open_count})</span>` : ''}
      </td>
      <td>
        <button class="btn btn-sm btn-outline btn-edit" data-id="${g.id}" title="Edit">✏️</button>
        <button class="btn btn-sm btn-outline btn-scrape-one" data-id="${g.id}" title="Scrape Email">🔍</button>
        ${g.emails && g.emails.length > 0 ? `<button class="btn btn-sm btn-primary btn-send-one" data-id="${g.id}" title="Send Email">📧</button>` : ''}
      </td>
    </tr>`).join('');

  if (galleries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:40px;">No galleries found. Use Search to discover galleries.</td></tr>';
  }
  document.getElementById('selectAll').checked = false;

  // Event listeners
  tbody.querySelectorAll('.gallery-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedGalleries.add(cb.dataset.id);
      else selectedGalleries.delete(cb.dataset.id);
      updateBatchActions();
    });
  });
  tbody.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', () => editGallery(btn.dataset.id)));
  tbody.querySelectorAll('.btn-scrape-one').forEach(btn => btn.addEventListener('click', () => scrapeOne(btn.dataset.id)));
  tbody.querySelectorAll('.btn-send-one').forEach(btn => btn.addEventListener('click', () => sendOne(btn.dataset.id)));
}

function updateBatchActions() {
  const bar = document.getElementById('batchActions');
  if (selectedGalleries.size > 0) {
    bar.style.display = 'flex';
    document.getElementById('selectedCount').textContent = `${selectedGalleries.size} selected`;
  } else {
    bar.style.display = 'none';
  }
}

// Select all
document.getElementById('selectAll').addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.gallery-check').forEach(cb => {
    cb.checked = checked;
    if (checked) selectedGalleries.add(cb.dataset.id);
    else selectedGalleries.delete(cb.dataset.id);
  });
  updateBatchActions();
});

// Filters
document.getElementById('gallerySearch').addEventListener('input', debounce(() => loadGalleries(true), 300));
document.getElementById('filterCity').addEventListener('change', () => loadGalleries(true));
document.getElementById('filterStatus').addEventListener('change', () => loadGalleries(true));
document.getElementById('filterEmail').addEventListener('change', () => loadGalleries(true));

// Edit gallery
async function editGallery(id) {
  const g = allGalleries.find(g => g.id === id);
  if (!g) return;
  openModal('Edit Gallery', `
    <div class="form-group"><label>Name</label><input class="input" id="editName" value="${esc(g.name)}"></div>
    <div class="form-group"><label>City</label><input class="input" id="editCity" value="${esc(g.city)}"></div>
    <div class="form-group"><label>Website</label><input class="input" id="editWebsite" value="${esc(g.website)}"></div>
    <div class="form-group"><label>Emails (comma separated)</label><input class="input" id="editEmails" value="${(g.emails || []).join(', ')}"></div>
    <div class="form-group"><label>Status</label>
      <select class="input select" id="editStatus">
        ${['new','contacted','replied','rejected','not_interested'].map(s => `<option value="${s}" ${g.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Notes</label><textarea class="input" id="editNotes">${esc(g.notes || '')}</textarea></div>
  `, `<button class="btn btn-primary" id="btnSaveEdit">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button>`);

  document.getElementById('btnSaveEdit').addEventListener('click', async () => {
    await api.put(`/api/galleries/${id}`, {
      name: document.getElementById('editName').value,
      city: document.getElementById('editCity').value,
      website: document.getElementById('editWebsite').value,
      emails: document.getElementById('editEmails').value.split(',').map(e => e.trim()).filter(Boolean),
      status: document.getElementById('editStatus').value,
      notes: document.getElementById('editNotes').value
    });
    closeModal(); toast('Gallery updated', 'success'); loadGalleries();
  });
}

// Add gallery
document.getElementById('btnAddGallery').addEventListener('click', () => {
  openModal('Add Gallery', `
    <div class="form-group"><label>Name</label><input class="input" id="addName" placeholder="Gallery name"></div>
    <div class="form-group"><label>City</label><input class="input" id="addCity" placeholder="City"></div>
    <div class="form-group"><label>Website</label><input class="input" id="addWebsite" placeholder="https://..."></div>
    <div class="form-group"><label>Email</label><input class="input" id="addEmail" placeholder="email@gallery.com"></div>
  `, `<button class="btn btn-primary" id="btnSaveAdd">Add</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button>`);

  document.getElementById('btnSaveAdd').addEventListener('click', async () => {
    await api.post('/api/galleries', {
      name: document.getElementById('addName').value,
      city: document.getElementById('addCity').value,
      website: document.getElementById('addWebsite').value,
      emails: document.getElementById('addEmail').value ? [document.getElementById('addEmail').value] : []
    });
    closeModal(); toast('Gallery added', 'success'); loadGalleries();
  });
});

// Export CSV
document.getElementById('btnExportCSV').addEventListener('click', () => {
  window.open('/api/galleries/export', '_blank');
});

// Scrape one gallery
async function scrapeOne(id) {
  toast('Scraping email...', 'info');
  try {
    const result = await api.post('/api/finder/scrape-single', { galleryId: id });
    if (result.emails && result.emails.length > 0) {
      toast(`Found: ${result.emails.join(', ')}`, 'success');
    } else {
      toast('No email found on website', 'error');
    }
    loadGalleries();
  } catch (err) { toast('Scrape failed', 'error'); }
}

// Send one email
async function sendOne(id) {
  const templates = await api.get('/api/emails/templates');
  if (templates.length === 0) { toast('No email templates found', 'error'); return; }

  openModal('Send Email', `
    <div class="form-group"><label>Template</label>
      <select class="input select" id="sendTemplate">${templates.map(t => `<option value="${esc(t.name)}">${esc(t.name)} — ${esc(t.subject)}</option>`).join('')}</select>
    </div>
    <p class="text-muted">Email will be sent to the first contact email of this gallery.</p>
  `, `<button class="btn btn-primary" id="btnConfirmSend">Send</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button>`);

  document.getElementById('btnConfirmSend').addEventListener('click', async () => {
    const template = document.getElementById('sendTemplate').value;
    closeModal();
    toast('Sending email...', 'info');
    try {
      const result = await api.post('/api/emails/send', { galleryId: id, template });
      if (result.success) toast(`Email sent to ${result.to}`, 'success');
      else toast(`Failed: ${result.error}`, 'error');
      loadGalleries();
    } catch (err) { toast('Send failed', 'error'); }
  });
}

// Batch send
document.getElementById('btnBatchSend').addEventListener('click', async () => {
  const ids = [...selectedGalleries];
  const withEmail = ids.filter(id => {
    const g = allGalleries.find(g => g.id === id);
    return g && g.emails && g.emails.length > 0;
  });
  if (withEmail.length === 0) { toast('No selected galleries have email addresses', 'error'); return; }

  const templates = await api.get('/api/emails/templates');
  if (templates.length === 0) { toast('No templates found', 'error'); return; }

  openModal('Batch Send', `
    <p>Send emails to <strong>${withEmail.length}</strong> galleries with email addresses.</p>
    <div class="form-group"><label>Template</label>
      <select class="input select" id="batchTemplate">${templates.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select>
    </div>
    <p class="text-muted" style="margin-top:10px;">⏱ Emails will be sent with a 45-second delay between each to avoid spam filters.</p>
  `, `<button class="btn btn-primary" id="btnConfirmBatch">Send ${withEmail.length} Emails</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button>`);

  document.getElementById('btnConfirmBatch').addEventListener('click', async () => {
    const template = document.getElementById('batchTemplate').value;
    closeModal();
    toast(`Sending ${withEmail.length} emails... This will take a while.`, 'info');
    try {
      const result = await api.post('/api/emails/send-batch', { galleryIds: withEmail, template });
      toast(`Done! Sent: ${result.sent}, Failed: ${result.failed}`, result.failed > 0 ? 'error' : 'success');
      selectedGalleries.clear(); updateBatchActions(); loadGalleries();
    } catch (err) { toast('Batch send failed', 'error'); }
  });
});

// Batch scrape
document.getElementById('btnBatchScrape').addEventListener('click', async () => {
  const ids = [...selectedGalleries];
  showProgress();
  setProgress(0, 'Starting scrape...');
  
  if (scrapeAbortController) scrapeAbortController.abort();
  scrapeAbortController = new AbortController();
  document.getElementById('btnStopScrape').style.display = 'block';

  let startTime = Date.now();
  try {
    await api.streamPost('/api/finder/scrape-emails', { galleryIds: ids }, (data) => {
      if (data.type === 'progress') {
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTime = elapsed / data.current;
        const remaining = Math.max(0, data.total - data.current) * avgTime;
        const min = Math.floor(remaining / 60);
        const sec = Math.floor(remaining % 60);
        setProgress((data.current / data.total) * 100, `Scraping: ${data.current}/${data.total} | Remaining: ~${min}m ${sec}s`);
      } else if (data.type === 'complete') {
        const msg = data.stopped ? 'Stopped' : `Complete! Updated ${data.updated} galleries.`;
        setProgress(100, msg);
        toast(msg, data.stopped ? 'info' : 'success');
        document.getElementById('btnStopScrape').style.display = 'none';
        loadGalleries();
      } else if (data.type === 'error') {
        toast('Scrape failed: ' + data.error, 'error');
        hideProgress();
        document.getElementById('btnStopScrape').style.display = 'none';
      }
    }, scrapeAbortController.signal);
  } catch (err) { 
    if (err.name !== 'AbortError') {
      toast('Batch scrape failed', 'error'); 
      hideProgress();
    }
    document.getElementById('btnStopScrape').style.display = 'none';
  }
});

// Batch delete
document.getElementById('btnBatchDelete').addEventListener('click', async () => {
  if (!confirm(`Delete ${selectedGalleries.size} galleries?`)) return;
  for (const id of selectedGalleries) { await api.del(`/api/galleries/${id}`); }
  selectedGalleries.clear(); updateBatchActions(); loadGalleries();
  toast('Galleries deleted', 'success');
});

// ── Config: Cities & Queries ─────────────────────────────
let configCities = [];
let configQueries = [];

const DEFAULT_CITIES = [
  'London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow',
  'Bristol', 'Liverpool', 'Leeds', 'Brighton', 'Oxford',
  'Cambridge', 'Cardiff', 'Bath', 'York', 'Norwich',
  'Sheffield', 'Nottingham', 'Newcastle', 'Belfast', 'Dundee',
  'Aberdeen', 'Margate', 'St Ives', 'Canterbury', 'Folkestone'
];
const DEFAULT_QUERIES = [
  'art gallery', 'contemporary art gallery', 'fine art gallery',
  'artist-run gallery', 'art exhibition space'
];

async function loadConfig() {
  try {
    const [citiesRes, queriesRes] = await Promise.all([
      api.get('/api/config/cities'),
      api.get('/api/config/queries')
    ]);
    configCities = citiesRes.cities || DEFAULT_CITIES;
    configQueries = queriesRes.queries || DEFAULT_QUERIES;
    renderCityChips();
    renderQueryChips();
  } catch (err) {
    configCities = [...DEFAULT_CITIES];
    configQueries = [...DEFAULT_QUERIES];
    renderCityChips();
    renderQueryChips();
  }
}

function renderCityChips() {
  const container = document.getElementById('cityChips');
  container.innerHTML = configCities.map((city, i) => `
    <span class="chip">
      ${esc(city)}
      <button class="chip-remove" data-type="city" data-index="${i}" title="Remove">×</button>
    </span>`).join('');
  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      configCities.splice(Number(btn.dataset.index), 1);
      saveCities();
    });
  });
}

function renderQueryChips() {
  const container = document.getElementById('queryChips');
  container.innerHTML = configQueries.map((q, i) => `
    <span class="chip chip-query">
      ${esc(q)}
      <button class="chip-remove" data-type="query" data-index="${i}" title="Remove">×</button>
    </span>`).join('');
  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      configQueries.splice(Number(btn.dataset.index), 1);
      saveQueries();
    });
  });
}

async function saveCities() {
  renderCityChips();
  try {
    await api.put('/api/config/cities', { cities: configCities });
    toast(`Cities saved (${configCities.length})`, 'success');
  } catch { toast('Failed to save cities', 'error'); }
}

async function saveQueries() {
  renderQueryChips();
  try {
    await api.put('/api/config/queries', { queries: configQueries });
    toast(`Queries saved (${configQueries.length})`, 'success');
  } catch { toast('Failed to save queries', 'error'); }
}

// Add city
document.getElementById('btnAddCity').addEventListener('click', () => {
  const input = document.getElementById('newCityInput');
  const val = input.value.trim();
  if (!val) return;
  if (configCities.includes(val)) { toast('City already in list', 'error'); return; }
  configCities.push(val);
  input.value = '';
  saveCities();
});
document.getElementById('newCityInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnAddCity').click();
});

// Add query
document.getElementById('btnAddQuery').addEventListener('click', () => {
  const input = document.getElementById('newQueryInput');
  const val = input.value.trim();
  if (!val) return;
  if (configQueries.includes(val)) { toast('Query already in list', 'error'); return; }
  configQueries.push(val);
  input.value = '';
  saveQueries();
});
document.getElementById('newQueryInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnAddQuery').click();
});

// Reset to defaults
document.getElementById('btnResetCities').addEventListener('click', async () => {
  if (!confirm('Reset cities to defaults?')) return;
  configCities = [...DEFAULT_CITIES];
  await saveCities();
});
document.getElementById('btnResetQueries').addEventListener('click', async () => {
  if (!confirm('Reset queries to defaults?')) return;
  configQueries = [...DEFAULT_QUERIES];
  await saveQueries();
});

// Collapse toggles
function setupCollapse(btnId, bodyId) {
  const btn = document.getElementById(btnId);
  const body = document.getElementById(bodyId);
  btn.addEventListener('click', () => {
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    btn.textContent = collapsed ? '▲ Collapse' : '▼ Expand';
  });
}
setupCollapse('btnToggleCities', 'citiesCardBody');
setupCollapse('btnToggleQueries', 'queriesCardBody');

// ── Search ───────────────────────────────────────────────
document.getElementById('btnSearchCity').addEventListener('click', async () => {
  const city = document.getElementById('searchCity').value.trim();
  if (!city) { toast('Enter a city name', 'error'); return; }
  showProgress();
  setProgress(50, `Searching for galleries in ${city}...`);
  try {
    const result = await api.post('/api/finder/search-city', { city });
    setProgress(100, `Found ${result.found} galleries in ${city}. Added: ${result.added}, Updated: ${result.updated}`);
    toast(`Found ${result.found} galleries in ${city}`, 'success');
  } catch (err) { toast('Search failed: ' + (err.message || 'API error'), 'error'); hideProgress(); }
});

document.getElementById('btnSearchAll').addEventListener('click', async () => {
  if (!confirm('This will search across all UK cities and use Google Places API credits. Continue?')) return;
  showProgress();
  setProgress(10, 'Searching all UK cities...');
  try {
    const result = await api.post('/api/finder/search', {});
    setProgress(100, `Complete! Found ${result.found} galleries. Added: ${result.added}, Updated: ${result.updated}`);
    toast(`Search complete! ${result.found} galleries found`, 'success');
  } catch (err) { toast('Search failed', 'error'); hideProgress(); }
});

document.getElementById('btnScrapeAll').addEventListener('click', async () => {
  showProgress();
  setProgress(0, 'Scraping emails from gallery websites...');

  if (scrapeAbortController) scrapeAbortController.abort();
  scrapeAbortController = new AbortController();
  document.getElementById('btnStopScrape').style.display = 'block';

  let startTime = Date.now();
  try {
    await api.streamPost('/api/finder/scrape-emails', {}, (data) => {
      if (data.type === 'progress') {
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTime = elapsed / data.current;
        const remaining = Math.max(0, data.total - data.current) * avgTime;
        const min = Math.floor(remaining / 60);
        const sec = Math.floor(remaining % 60);
        setProgress((data.current / data.total) * 100, `Scraping: ${data.current}/${data.total} | Remaining: ~${min}m ${sec}s`);
      } else if (data.type === 'complete') {
        const msg = data.stopped ? 'Scraping Stopped' : `Complete! Scraped ${data.processed} websites, found emails for ${data.updated} galleries.`;
        setProgress(100, msg);
        toast(msg, data.stopped ? 'info' : 'success');
        document.getElementById('btnStopScrape').style.display = 'none';
        loadGalleries();
      } else if (data.type === 'error') {
        toast('Scrape failed: ' + data.error, 'error');
        hideProgress();
        document.getElementById('btnStopScrape').style.display = 'none';
      }
    }, scrapeAbortController.signal);
  } catch (err) { 
    if (err.name !== 'AbortError') {
      toast('Scrape failed', 'error'); 
      hideProgress();
    }
    document.getElementById('btnStopScrape').style.display = 'none';
  }
});

document.getElementById('btnStopScrape').addEventListener('click', () => {
  if (scrapeAbortController) {
    scrapeAbortController.abort();
    scrapeAbortController = null;
    toast('Stopping scraper...', 'info');
  }
});

function showProgress() { document.getElementById('searchProgress').style.display = 'block'; }
function hideProgress() { document.getElementById('searchProgress').style.display = 'none'; }
function setProgress(pct, text) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = text;
}

// ── Templates ────────────────────────────────────────────
async function loadTemplates() {
  try {
    const templates = await api.get('/api/emails/templates');
    const grid = document.getElementById('templatesGrid');
    grid.innerHTML = templates.map(t => `
      <div class="template-card" data-name="${esc(t.name)}">
        <h4>${esc(t.name)}</h4>
        <div class="subject">${esc(t.subject)}</div>
        <div class="preview-text">${esc(t.preview)}</div>
      </div>`).join('');
    if (templates.length === 0) {
      grid.innerHTML = '<p class="text-muted">No templates found in /templates folder.</p>';
    }
    grid.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => previewTemplate(card.dataset.name));
    });
  } catch (err) { toast('Failed to load templates', 'error'); }
}

async function previewTemplate(name) {
  try {
    const rendered = await api.post('/api/emails/preview', { template: name, gallery_name: 'Whitechapel Gallery' });
    document.getElementById('previewSubject').textContent = `Subject: ${rendered.subject}`;
    document.getElementById('previewBody').innerHTML = rendered.html;
    document.getElementById('templatePreview').style.display = 'block';
  } catch (err) { toast('Preview failed', 'error'); }
}

document.getElementById('btnClosePreview').addEventListener('click', () => {
  document.getElementById('templatePreview').style.display = 'none';
});

// ── Send Log ─────────────────────────────────────────────
async function loadSendLog() {
  try {
    const data = await api.get('/api/emails/log');
    const tbody = document.getElementById('sendLogBody');
    tbody.innerHTML = data.log.map(entry => `
      <tr>
        <td>${new Date(entry.sent_at).toLocaleString()}</td>
        <td>${esc(entry.gallery_name || entry.gallery_id)}</td>
        <td>${esc(entry.email_to)}</td>
        <td>${esc(entry.template)}</td>
        <td>${statusBadge(entry.status)}</td>
      </tr>`).join('');
    if (data.log.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:40px;">No emails sent yet.</td></tr>';
    }
  } catch (err) { toast('Failed to load send log', 'error'); }
}

// ── SMTP Verify ──────────────────────────────────────────
document.getElementById('btnSmtpVerify').addEventListener('click', async () => {
  toast('Verifying SMTP connection...', 'info');
  try {
    const result = await api.post('/api/emails/verify', {});
    if (result.ok) toast('SMTP connection OK!', 'success');
    else toast('SMTP failed: ' + result.message, 'error');
  } catch (err) { toast('SMTP verification failed', 'error'); }
});

// ── Helpers ──────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}
function statusBadge(status) {
  const raw = String(status || 'new');
  const className = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `<span class="badge badge-${className}">${esc(raw)}</span>`;
}
function websiteCell(url) {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) return '<span class="text-muted">—</span>';
  return `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(safeUrl)}">${esc(truncate(safeUrl, 30))}</a>`;
}
function safeExternalUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (err) {
    return '';
  }
}
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Init ─────────────────────────────────────────────────
loadDashboard();
loadConfig();
