// Shared server-side helpers for tradesmyran.
// Runs on the server only. No npm dependencies: uses the global fetch.
//
// Data: public Form 4 filings. Every request to the public filing archive
// carries a declared User-Agent and is paced to stay well under the
// archive's fair-access limit of 10 requests per second.

const USER_AGENT = 'tradesmyran/1.0 (contact: user@example.com)';
const ARCHIVE = 'https://www.sec.gov';
const DATA_HOST = 'https://data.sec.gov';

// --- request pacing -------------------------------------------------------
// Keep at least 120ms between request starts inside one instance and allow
// at most 4 requests in flight, so bursts never approach 10 req/s.
let lastStart = 0;
let inFlight = 0;
const waiting = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  const now = Date.now();
  const wait = 120 - (now - lastStart);
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  while (inFlight >= 4) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
}

function release() {
  inFlight -= 1;
  const next = waiting.shift();
  if (next) next();
}

async function archiveFetch(url) {
  await pace();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/xml, application/xml, text/html, */*',
      },
    });
    if (!res.ok) {
      const err = new Error('Upstream request failed: ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    release();
  }
}

async function fetchJson(url) {
  const res = await archiveFetch(url);
  return res.json();
}

async function fetchText(url) {
  const res = await archiveFetch(url);
  return res.text();
}

// --- tiny in-memory cache (per server instance) ---------------------------
const cache = new Map();
function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return null;
}
function cacheSet(key, value) {
  cache.set(key, value);
  if (cache.size > 50) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

// --- ticker resolution -----------------------------------------------------
// The public company-ticker directory maps symbols to CIKs.
async function resolveTicker(symbol) {
  const clean = String(symbol || '').trim().toUpperCase();
  let dir = cacheGet('tickers', 24 * 60 * 60 * 1000);
  if (!dir) {
    dir = await fetchJson(ARCHIVE + '/files/company_tickers.json');
    cacheSet('tickers', dir);
  }
  for (const key of Object.keys(dir)) {
    const row = dir[key];
    const t = row.ticker || row.symbol;
    if (t && String(t).toUpperCase() === clean) {
      const cik = row.cik_str != null ? row.cik_str : row.cik;
      return { ticker: String(t).toUpperCase(), cik: Number(cik), name: row.title || row.name || '' };
    }
  }
  return null;
}

function padCik(cik) {
  return String(cik).padStart(10, '0');
}

// --- per-company filings ---------------------------------------------------
async function getSubmissions(cik) {
  const key = 'subs:' + cik;
  let data = cacheGet(key, 10 * 60 * 1000);
  if (!data) {
    data = await fetchJson(DATA_HOST + '/submissions/CIK' + padCik(cik) + '.json');
    cacheSet(key, data);
  }
  return data;
}

// Form 4 filings for one company, newest first. Uses the recent-filings list
// only (the newest ~1000 filings); older filings live in separate files.
function listCompanyForm4(submissions) {
  const recent = (submissions && submissions.filings && submissions.filings.recent) || {};
  const out = [];
  const n = (recent.form || []).length;
  for (let i = 0; i < n; i++) {
    const form = recent.form[i];
    if (form !== '4' && form !== '4/A') continue;
    out.push({
      form,
      accession: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      primaryDocument: recent.primaryDocument[i],
      amended: form === '4/A',
    });
  }
  return out;
}

// Build the document URL for a company filing. The directory under the
// archive is keyed by the CIK embedded at the start of the accession number.
// Some primary documents carry an XSLT-render prefix (xslF345X06/...) that
// serves a styled page instead of the raw filing: strip it, or parsing
// yields zero trades.
function stripXsltPrefix(doc) {
  return String(doc || '').replace(/^xslF345X06\//, '');
}

function companyFilingUrl(filing) {
  const acc = filing.accession;
  const dirCik = String(parseInt(acc.split('-')[0], 10));
  const accNoDash = acc.replace(/-/g, '');
  const doc = stripXsltPrefix(filing.primaryDocument);
  return ARCHIVE + '/Archives/edgar/data/' + dirCik + '/' + accNoDash + '/' + doc;
}

// --- recent filings across all companies ----------------------------------
// The current-filings feed lists the newest filings of a given form.
async function getRecentFilings() {
  let entries = cacheGet('recent', 5 * 60 * 1000);
  if (entries) return entries;
  const xml = await fetchText(
    ARCHIVE + '/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom'
  );
  entries = [];
  const seenAccession = new Set();
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const block of blocks) {
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"[^>]*>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const updatedMatch = block.match(/<updated>([^<]+)<\/updated>/);
    const idMatch = block.match(/accession-number=([0-9-]+)/);
    if (!linkMatch) continue;
    // Each filing appears twice in the feed (once per Reporting owner, once
    // per Issuer), pointing at the same document. Keep the first occurrence.
    const accKey = idMatch ? idMatch[1] : null;
    if (accKey) {
      if (seenAccession.has(accKey)) continue;
      seenAccession.add(accKey);
    }
    const href = linkMatch[1];
    const m = href.match(/\/Archives\/edgar\/data\/(\d+)\/(\d+)\//);
    if (!m) continue;
    entries.push({
      cik: m[1],
      accNoDash: m[2],
      accession: idMatch ? idMatch[1] : null,
      filingDate: updatedMatch ? updatedMatch[1].slice(0, 10) : null,
      title: titleMatch ? titleMatch[1].trim() : '',
      amended: titleMatch ? /^4\/A\b/.test(titleMatch[1].trim()) : false,
    });
  }
  cacheSet('recent', entries);
  return entries;
}

// The primary document of a filing, from its archive directory listing.
// Picks the raw ownership XML: prefers names that look like a form document,
// otherwise the first .xml file in the listing.
async function getPrimaryDoc(cik, accNoDash) {
  const key = 'idx:' + cik + ':' + accNoDash;
  let name = cacheGet(key, 60 * 60 * 1000);
  if (name) return name;
  const data = await fetchJson(
    ARCHIVE + '/Archives/edgar/data/' + cik + '/' + accNoDash + '/index.json'
  );
  const items = (data && data.directory && data.directory.item) || [];
  const xmls = items.filter((it) => /\.xml$/i.test(it.name || ''));
  let pick = xmls.find((it) => /form4|wf-|wk-|fp\d/i.test(it.name));
  if (!pick) pick = xmls[0];
  name = pick ? pick.name : null;
  if (name) cacheSet(key, name);
  return name;
}

function recentFilingUrl(entry, primaryDoc) {
  return ARCHIVE + '/Archives/edgar/data/' + entry.cik + '/' + entry.accNoDash + '/' + primaryDoc;
}

module.exports = {
  USER_AGENT,
  archiveFetch,
  fetchJson,
  fetchText,
  resolveTicker,
  getSubmissions,
  listCompanyForm4,
  companyFilingUrl,
  stripXsltPrefix,
  getRecentFilings,
  getPrimaryDoc,
  recentFilingUrl,
};
