// GET /api/search?q=SNOW
// Ticker-style queries are resolved to a company and return the first batch
// of that company's Form 4 trades (the frontend pages the rest with
// /api/ticker-batch). Anything that is not a ticker symbol returns
// localOnly: true, and the frontend filters the trades it already loaded.
const sec = require('../lib/sec');
const { parseOwnership } = require('../lib/parse');

function stripExchangePrefix(q) {
  return String(q || '')
    .trim()
    .replace(/^(NYSE|NASDAQ|AMEX|NYSEARCA|NYSEAMERICAN|OTC)[\s:]+/i, '')
    .trim()
    .toUpperCase();
}

module.exports = async (req, res) => {
  try {
    const q = stripExchangePrefix(req.query.q);
    if (!q) {
      res.status(400).json({ error: 'A search term is required.' });
      return;
    }
    if (!/^[A-Z][A-Z.]{0,5}$/.test(q)) {
      res.status(200).json({ localOnly: true, query: q, trades: [] });
      return;
    }
    const company = await sec.resolveTicker(q);
    if (!company) {
      res.status(200).json({ found: false, ticker: q, trades: [], total: 0, nextOffset: 0, done: true });
      return;
    }
    const submissions = await sec.getSubmissions(company.cik);
    const filings = sec.listCompanyForm4(submissions);
    const slice = filings.slice(0, 8);
    const jobs = slice.map(async (filing) => {
      try {
        const url = sec.companyFilingUrl(filing);
        const xml = await sec.fetchText(url);
        return parseOwnership(xml, {
          accession: filing.accession,
          filingDate: filing.filingDate,
          filingUrl: url,
          amended: filing.amended,
        });
      } catch (e) {
        return [];
      }
    });
    const results = await Promise.all(jobs);
    const trades = [];
    for (const rows of results) trades.push(...rows);
    trades.sort((a, b) => String(b.filingDate || '').localeCompare(String(a.filingDate || '')));
    res.status(200).json({
      found: true,
      ticker: company.ticker,
      company: company.name || submissions.name || '',
      trades,
      total: filings.length,
      nextOffset: slice.length,
      done: slice.length >= filings.length,
    });
  } catch (e) {
    res.status(502).json({ error: 'Search failed. Please try again.' });
  }
};
