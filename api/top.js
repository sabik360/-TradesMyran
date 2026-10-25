// GET /api/top?offset=0&limit=8
// Trades for the Top view. Same recent-filings batches as /api/latest; the
// frontend accumulates them and ranks by value and ownership change, so Top
// always reflects the currently loaded recent window.
const { parseOffset, parseLimit, getRecentBatch } = require('../lib/recent');

module.exports = async (req, res) => {
  try {
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, 8, 16);
    const result = await getRecentBatch(offset, limit);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: 'Could not load top trades. Please try again.' });
  }
};
