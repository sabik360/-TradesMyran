// GET /api/latest?offset=0&limit=8
// Newest Form 4 trades, paged in small batches (see lib/recent.js).
const { parseOffset, parseLimit, getRecentBatch } = require('../lib/recent');

module.exports = async (req, res) => {
  try {
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, 8, 16);
    const result = await getRecentBatch(offset, limit);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: 'Could not load recent filings. Please try again.' });
  }
};
