// GET /api/feed?offset=0&limit=8
// The full recent-filings stream, paged. Same batch mechanism as /api/latest;
// the frontend keeps paging it as the visitor scrolls or loads more.
const { parseOffset, parseLimit, getRecentBatch } = require('../lib/recent');

module.exports = async (req, res) => {
  try {
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, 8, 16);
    const result = await getRecentBatch(offset, limit);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: 'Could not load the feed. Please try again.' });
  }
};
