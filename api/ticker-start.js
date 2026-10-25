// GET /api/ticker-start?ticker=SNOW
// Resolves a symbol to a company and reports how many Form 4 filings it has.
// The frontend then pages through them with /api/ticker-batch.
const sec = require('../lib/sec');

module.exports = async (req, res) => {
  try {
    const symbol = String(req.query.ticker || '').trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'A ticker symbol is required.' });
      return;
    }
    const company = await sec.resolveTicker(symbol);
    if (!company) {
      res.status(200).json({ found: false, ticker: symbol });
      return;
    }
    const submissions = await sec.getSubmissions(company.cik);
    const filings = sec.listCompanyForm4(submissions);
    res.status(200).json({
      found: true,
      ticker: company.ticker,
      company: company.name || submissions.name || '',
      cik: company.cik,
      total: filings.length,
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not look up that ticker. Please try again.' });
  }
};
