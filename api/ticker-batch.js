// GET /api/ticker-batch?ticker=SNOW&offset=0&limit=8
// Parses one batch of a company's Form 4 filings and returns the trades plus
// progress info, so the frontend can stream results in with a live counter.
const sec = require('../lib/sec');
const { parseOwnership } = require('../lib/parse');
const { parseOffset, parseLimit } = require('../lib/recent');

module.exports = async (req, res) => {
  try {
    const symbol = String(req.query.ticker || '').trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'A ticker symbol is required.' });
      return;
    }
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, 8, 16);
    const company = await sec.resolveTicker(symbol);
    if (!company) {
      res.status(200).json({ found: false, ticker: symbol, trades: [], total: 0, nextOffset: 0, done: true });
      return;
    }
    const submissions = await sec.getSubmissions(company.cik);
    const filings = sec.listCompanyForm4(submissions);
    const slice = filings.slice(offset, offset + limit);
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
    const nextOffset = offset + slice.length;
    res.status(200).json({
      found: true,
      ticker: company.ticker,
      company: company.name || submissions.name || '',
      trades,
      total: filings.length,
      nextOffset,
      done: nextOffset >= filings.length,
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not load that company\'s filings. Please try again.' });
  }
};
