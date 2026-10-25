// tradesmyran — frontend. No build step, no fake data: every trade shown
// here comes from the /api functions. Trades are accumulated client-side and
// every view (Latest, Feed, Top, Search) renders from that pool.

const $ = (sel) => document.querySelector(sel);

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPrice(p) {
  if (p == null) return '—';
  return p < 1 ? p.toFixed(4) : p.toFixed(2);
}
function fmtInt(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('en-US');
}
function fmtMoney(v) {
  if (v == null) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
}
function fmtDate(d) {
  return d ? String(d).slice(0, 10) : '—';
}

function stripExchangePrefix(q) {
  return String(q || '')
    .trim()
    .replace(/^(NYSE|NASDAQ|AMEX|NYSEARCA|NYSEAMERICAN|OTC)[\s:]+/i, '')
    .trim();
}

function isTickerLike(q) {
  return /^[A-Z][A-Z.]{0,5}$/.test(q);
}

// ---------- theme ----------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('tradesmyran-theme', theme); } catch (e) {}
  $('#themeBtn').textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// ---------- state ----------
const pool = []; // recent trades from /api/latest, /api/feed, /api/top
const poolIds = new Set();
const poolJob = { nextOffset: 0, total: 0, done: false, loading: false };

let searchTrades = [];
let searchJob = null; // { ticker, company, total, nextOffset, done }
let activeTab = 'latest';

function addTrades(list, target, targetIds) {
  for (const t of list || []) {
    if (t && t.id && !targetIds.has(t.id)) {
      targetIds.add(t.id);
      target.push(t);
    }
  }
}

// ---------- filters ----------
function roleMatches(trade, role) {
  const r = String(trade.role || '');
  if (role === 'director') return /director/i.test(r);
  if (role === 'owner') return /10%/.test(r);
  if (role === 'officer') {
    return /officer|chief|ceo|cfo|cto|president|chair|treasurer|secretary|controller|\bEVP\b|\bSVP\b|\bVP\b/i.test(r);
  }
  return true;
}

function applyFilters(trades) {
  const type = $('#typeFilter').value;
  const minV = parseFloat($('#minValueFilter').value);
  const role = $('#roleFilter').value;
  return trades.filter((t) => {
    if (type === 'P' && t.type !== 'P') return false;
    if (type === 'S' && t.type !== 'S') return false;
    if (Number.isFinite(minV) && (t.value || 0) < minV) return false;
    if (role !== 'all' && !roleMatches(t, role)) return false;
    return true;
  });
}

function byFilingDesc(a, b) {
  return String(b.filingDate || '').localeCompare(String(a.filingDate || '')) ||
    String(b.tradeDate || '').localeCompare(String(a.tradeDate || ''));
}

// ---------- rendering ----------
function tradeRow(t) {
  const cls = t.type === 'P' ? 'buy' : t.type === 'S' ? 'sell' : '';
  const typeText = t.type === 'P' ? 'Buy' : t.type === 'S' ? 'Sale' : esc(t.typeLabel || t.type);
  return '<tr class="trade-row" data-id="' + esc(t.id) + '">' +
    '<td>' + esc(fmtDate(t.filingDate)) + (t.amended ? ' <span class="amended">A</span>' : '') + '</td>' +
    '<td>' + esc(fmtDate(t.tradeDate)) + '</td>' +
    '<td class="ticker">' + esc(t.ticker || '—') + '</td>' +
    '<td>' + esc(t.company || '—') + '</td>' +
    '<td>' + esc(t.insider || '—') + '</td>' +
    '<td class="hide-sm">' + esc(t.role || '—') + '</td>' +
    '<td class="' + cls + '">' + typeText + '</td>' +
    '<td class="num">$' + esc(fmtPrice(t.price)) + '</td>' +
    '<td class="num">' + esc(fmtInt(t.shares)) + '</td>' +
    '<td class="num">' + esc(fmtMoney(t.value)) + '</td>' +
    '<td class="num hide-sm">' + esc(fmtInt(t.ownedAfter)) + '</td>' +
    '<td class="num">' + esc(fmtPct(t.pctChange)) + '</td>' +
    '</tr>';
}

function tradeTable(trades, emptyText) {
  if (!trades.length) return '<p class="empty">' + esc(emptyText) + '</p>';
  return '<table><thead><tr>' +
    '<th>Filed</th><th>Trade</th><th>Ticker</th><th>Company</th><th>Insider</th>' +
    '<th class="hide-sm">Role</th><th>Type</th><th class="num">Price</th><th class="num">Shares</th>' +
    '<th class="num">Value</th><th class="num hide-sm">Owned after</th><th class="num">% chg</th>' +
    '</tr></thead><tbody>' + trades.map(tradeRow).join('') + '</tbody></table>';
}

function section(title, trades, emptyText) {
  return '<h2>' + esc(title) + '</h2>' + tradeTable(trades, emptyText);
}

function clusterBuys(trades) {
  const buys = trades.filter((t) => t.type === 'P' && t.ticker);
  const byTicker = {};
  for (const t of buys) (byTicker[t.ticker] = byTicker[t.ticker] || []).push(t);
  const clusters = [];
  for (const ticker of Object.keys(byTicker)) {
    const list = byTicker[ticker].slice().sort((a, b) =>
      String(a.tradeDate || '').localeCompare(String(b.tradeDate || '')));
    for (let i = 0; i < list.length; i++) {
      const windowStart = list[i].tradeDate;
      if (!windowStart) continue;
      const start = new Date(windowStart).getTime();
      const inWindow = list.filter((t) => {
        if (!t.tradeDate) return false;
        const d = new Date(t.tradeDate).getTime();
        return d >= start && d <= start + 14 * 24 * 3600 * 1000;
      });
      const insiders = new Set(inWindow.map((t) => t.insider));
      if (insiders.size >= 2) {
        clusters.push({
          ticker,
          company: list[i].company,
          insiders: Array.from(insiders),
          trades: inWindow,
          totalValue: inWindow.reduce((s, t) => s + (t.value || 0), 0),
          latest: inWindow[inWindow.length - 1].tradeDate,
        });
        break;
      }
    }
  }
  clusters.sort((a, b) => String(b.latest || '').localeCompare(String(a.latest || '')));
  if (!clusters.length) {
    return '<h2>Cluster Buys</h2><p class="empty">No cluster buys in the loaded filings yet — a cluster needs 2 or more insiders buying the same stock within 14 days. It fills in automatically as new filings load.</p>';
  }
  let html = '<h2>Cluster Buys</h2><table><thead><tr>' +
    '<th>Ticker</th><th>Company</th><th>Insiders</th><th class="num">Total value</th><th>Latest trade</th>' +
    '</tr></thead><tbody>';
  for (const c of clusters) {
    html += '<tr><td class="ticker">' + esc(c.ticker) + '</td><td>' + esc(c.company || '—') + '</td>' +
      '<td>' + esc(c.insiders.length) + ' — ' + esc(c.insiders.join(', ')) + '</td>' +
      '<td class="num">' + esc(fmtMoney(c.totalValue)) + '</td>' +
      '<td>' + esc(fmtDate(c.latest)) + '</td></tr>';
  }
  return html + '</tbody></table>';
}

function renderLatest() {
  const t = applyFilters(pool);
  const buys = t.filter((x) => x.type === 'P').sort(byFilingDesc);
  const sales = t.filter((x) => x.type === 'S').sort(byFilingDesc);
  const penny = buys.filter((x) => x.price != null && x.price < 5);
  const bigSales = sales.filter((x) => (x.value || 0) > 100000);
  $('#latestSections').innerHTML =
    clusterBuys(t) +
    section('Latest Insider Buys', buys.slice(0, 30), 'No buys in the loaded filings yet.') +
    section('Latest Insider Sales', sales.slice(0, 30), 'No sales in the loaded filings yet.') +
    section('Latest Penny Stock Buys', penny.slice(0, 30), 'No penny stock buys in the loaded filings yet.') +
    section('Insider Sales $100K+', bigSales.slice(0, 30), 'No sales over $100,000 in the loaded filings yet.');
  bindRows($('#latestSections'));
}

function renderFeed() {
  const t = applyFilters(pool).sort(byFilingDesc);
  $('#feedTable').innerHTML = tradeTable(t, 'No trades loaded yet.');
  bindRows($('#feedTable'));
}

function renderTop() {
  const t = applyFilters(pool);
  const buys = t.filter((x) => x.type === 'P').sort((a, b) => (b.value || 0) - (a.value || 0));
  const sales = t.filter((x) => x.type === 'S').sort((a, b) => (b.value || 0) - (a.value || 0));
  const pct = t.filter((x) => x.pctChange != null && x.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange);
  $('#topSections').innerHTML =
    section('Top Insider Buys', buys.slice(0, 10), 'No buys in the loaded filings yet.') +
    section('Top Insider Sales', sales.slice(0, 10), 'No sales in the loaded filings yet.') +
    section('Top Ownership Increases', pct.slice(0, 10), 'No ownership increases in the loaded filings yet.');
  bindRows($('#topSections'));
}

function renderSearchResults(note) {
  const t = applyFilters(searchTrades).sort(byFilingDesc);
  let html = '';
  if (note) html += '<p class="muted">' + esc(note) + '</p>';
  html += tradeTable(t, 'No trades found.');
  $('#searchResults').innerHTML = html;
  bindRows($('#searchResults'));
}

function renderActive() {
  if (activeTab === 'latest') renderLatest();
  else if (activeTab === 'feed') renderFeed();
  else if (activeTab === 'top') renderTop();
}

function bindRows(container) {
  container.querySelectorAll('tr.trade-row').forEach((row) => {
    row.addEventListener('click', () => {
      const trade = pool.concat(searchTrades).find((t) => t.id === row.dataset.id);
      if (trade) openModal(trade);
    });
  });
}

// ---------- modal ----------
function openModal(trade) {
  const all = pool.concat(searchTrades);
  const filingTrades = all.filter((t) => t.accession && trade.accession && t.accession === trade.accession);
  const others = all
    .filter((t) => t.insider === trade.insider && t.accession !== trade.accession)
    .sort(byFilingDesc)
    .slice(0, 10);
  let html = '<h2>' + esc(trade.ticker || '') + ' — ' + esc(trade.company || '') + '</h2>' +
    '<dl class="kv">' +
    '<dt>Insider</dt><dd>' + esc(trade.insider || '—') + '</dd>' +
    '<dt>Role</dt><dd>' + esc(trade.role || '—') + '</dd>' +
    '<dt>Trade</dt><dd>' + esc(trade.typeLabel || trade.type) + ' — ' + esc(fmtInt(trade.shares)) +
    ' shares at $' + esc(fmtPrice(trade.price)) + ' (' + esc(fmtMoney(trade.value)) + ')</dd>' +
    '<dt>Trade date</dt><dd>' + esc(fmtDate(trade.tradeDate)) + '</dd>' +
    '<dt>Filed</dt><dd>' + esc(fmtDate(trade.filingDate)) + (trade.amended ? ' (amended)' : '') + '</dd>' +
    '<dt>Owned after</dt><dd>' + esc(fmtInt(trade.ownedAfter)) + '</dd>' +
    '<dt>Ownership change</dt><dd>' + esc(fmtPct(trade.pctChange)) + '</dd>' +
    '</dl>';
  if (filingTrades.length > 1) {
    html += '<h3>Transactions in this filing</h3>' + tradeTable(filingTrades, '');
  }
  if (others.length) {
    html += '<h3>Other trades by this insider</h3>' + tradeTable(others, '');
  }
  if (trade.filingUrl) {
    html += '<a class="filing-link" href="' + esc(trade.filingUrl) + '" target="_blank" rel="noopener">View filing</a>';
  }
  $('#modalContent').innerHTML = html;
  bindRows($('#modalContent'));
  $('#modalBackdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
}

// ---------- ingestion ----------
function setStatus(text) {
  $('#statusLine').textContent = text;
}

async function fetchBatch(endpoint, offset, limit) {
  const res = await fetch(endpoint + '?offset=' + offset + '&limit=' + limit);
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}

// Load more recent filings into the pool (default 40 filings ≈ 5 batches).
async function ingestRecent(filingTarget) {
  if (poolJob.loading || poolJob.done) return;
  poolJob.loading = true;
  let parsed = 0;
  try {
    while (parsed < filingTarget && !poolJob.done) {
      setStatus('Fetching live Form 4 filings… ' + pool.length + ' trades loaded.');
      const data = await fetchBatch('/api/latest', poolJob.nextOffset, 8);
      const before = pool.length;
      addTrades(data.trades, pool, poolIds);
      poolJob.nextOffset = data.nextOffset;
      poolJob.total = data.total;
      poolJob.done = data.done;
      parsed += 8;
      if (data.trades.length === 0 && pool.length === before && data.done) break;
      renderActive();
    }
    setStatus(pool.length
      ? pool.length + ' trades loaded from recent filings.'
      : 'No trades found in recent filings. Try refreshing.');
  } catch (e) {
    setStatus('Could not load filings. Check your connection and try refreshing.');
  } finally {
    poolJob.loading = false;
    renderActive();
  }
}

async function refreshAll() {
  pool.length = 0;
  poolIds.clear();
  poolJob.nextOffset = 0;
  poolJob.total = 0;
  poolJob.done = false;
  await ingestRecent(40);
}

// ---------- search ----------
async function runSearch(rawQuery) {
  const cleaned = stripExchangePrefix(rawQuery);
  const upper = cleaned.toUpperCase();
  const q = cleaned.toLowerCase();
  const local = pool.filter((t) =>
    (t.ticker && t.ticker.toLowerCase().includes(q)) ||
    (t.company && t.company.toLowerCase().includes(q)) ||
    (t.insider && t.insider.toLowerCase().includes(q)));
  const localTicker = pool.filter((t) => t.ticker && t.ticker.toUpperCase() === upper);

  // A plain ticker search with no local ticker match loads that company on demand.
  if (isTickerLike(upper) && localTicker.length === 0) {
    searchTrades = [];
    searchJob = null;
    setStatus('Looking up ' + upper + '…');
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(upper));
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (data.localOnly) {
        renderSearchResults('No company or insider matches in the loaded trades.');
        return;
      }
      if (data.found === false) {
        renderSearchResults('Checked for ' + upper + ': no Form 4 filings found for this symbol.');
        setStatus('No filings found for ' + upper + '.');
        return;
      }
      const ids = new Set();
      addTrades(data.trades, searchTrades, ids);
      searchJob = {
        ticker: data.ticker,
        company: data.company,
        total: data.total,
        nextOffset: data.nextOffset,
        done: data.done,
      };
      let parsed = data.nextOffset;
      renderSearchResults('Showing ' + data.ticker + ' — ' + (data.company || '') + '.');
      // Keep paging the company's filings, streaming results in.
      while (!searchJob.done) {
        setStatus('Fetching ' + data.ticker + ' filings — ' + parsed + ' of ' + data.total + ' downloaded');
        const batchRes = await fetch('/api/ticker-batch?ticker=' + encodeURIComponent(data.ticker) +
          '&offset=' + searchJob.nextOffset + '&limit=8');
        if (!batchRes.ok) throw new Error('Search failed');
        const batch = await batchRes.json();
        addTrades(batch.trades, searchTrades, ids);
        searchJob.nextOffset = batch.nextOffset;
        searchJob.done = batch.done;
        parsed = batch.nextOffset;
        renderSearchResults('Showing ' + data.ticker + ' — ' + (data.company || '') + '.');
      }
      setStatus(searchTrades.length + ' trades found for ' + data.ticker + '.');
    } catch (e) {
      setStatus('Search failed. Please try again.');
      renderSearchResults('Search failed. Please try again.');
    }
    return;
  }

  searchTrades = local;
  renderSearchResults(local.length
    ? 'Results for "' + cleaned + '" in the loaded trades.'
    : 'No trades found for "' + cleaned + '" in the loaded trades. Try a ticker symbol to load its filings on demand.');
}

// ---------- events ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    activeTab = btn.dataset.tab;
    document.getElementById('view-' + activeTab).classList.add('active');
    renderActive();
  });
});

['typeFilter', 'minValueFilter', 'roleFilter'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderActive);
  document.getElementById(id).addEventListener('change', renderActive);
});

$('#themeBtn').addEventListener('click', () => {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});

$('#refreshBtn').addEventListener('click', refreshAll);
$('#latestMoreBtn').addEventListener('click', () => ingestRecent(24));
$('#feedMoreBtn').addEventListener('click', () => ingestRecent(24));
$('#topMoreBtn').addEventListener('click', () => ingestRecent(24));

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'search'));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  activeTab = 'search';
  document.getElementById('view-search').classList.add('active');
  runSearch($('#searchInput').value);
});

$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#modalBackdrop')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ---------- boot ----------
applyTheme(currentTheme());
ingestRecent(40);
