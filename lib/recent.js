// Shared batch handler for the recent-filings endpoints (latest, feed, top).
// The frontend pages through the newest Form 4 filings in small batches so
// no single serverless call runs long: each batch parses a handful of
// filings and returns the trades plus the next offset.

const sec = require('./sec');
const { parseOwnership } = require('./parse');

function parseOffset(q) {
  const n = parseInt(q, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseLimit(q, fallback, cap) {
  const n = parseInt(q, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, cap);
}

async function getRecentBatch(offset, limit) {
  const entries = await sec.getRecentFilings();
  const slice = entries.slice(offset, offset + limit);
  const trades = [];
  const jobs = slice.map(async (entry) => {
    try {
      const primaryDoc = await sec.getPrimaryDoc(entry.cik, entry.accNoDash);
      if (!primaryDoc) return [];
      const url = sec.recentFilingUrl(entry, primaryDoc);
      const xml = await sec.fetchText(url);
      return parseOwnership(xml, {
        accession: entry.accession,
        filingDate: entry.filingDate,
        filingUrl: url,
        amended: entry.amended,
      });
    } catch (e) {
      // One unreadable filing must not fail the whole batch.
      return [];
    }
  });
  const results = await Promise.all(jobs);
  const seen = new Set();
  for (const rows of results) {
    for (const t of rows) {
      if (t && t.id && !seen.has(t.id)) {
        seen.add(t.id);
        trades.push(t);
      }
    }
  }
  trades.sort((a, b) => String(b.filingDate || '').localeCompare(String(a.filingDate || '')));
  const nextOffset = offset + slice.length;
  return {
    trades,
    total: entries.length,
    nextOffset,
    done: nextOffset >= entries.length,
  };
}

module.exports = { parseOffset, parseLimit, getRecentBatch };
