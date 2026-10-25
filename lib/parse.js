// Minimal parser for Form 4 ownership XML documents.
// No dependencies: targeted regex extraction over the known document shape.
// Only non-derivative transactions are parsed (open-market trades, awards,
// tax withholding, gifts, option exercises).

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Value of <tag><value>...</value></tag>, or plain <tag>...</tag>.
function tagValue(block, tag) {
  let m = block.match(new RegExp('<' + tag + '>(?:\\s*<value>)?([\\s\\S]*?)(?:</value>)?\\s*</' + tag + '>'));
  if (!m) return null;
  const v = decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
  return v === '' ? null : v;
}

function tagFlag(block, tag) {
  const v = tagValue(block, tag);
  return v === '1' || (v && v.toLowerCase() === 'true');
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const TYPE_LABELS = {
  P: 'Purchase',
  S: 'Sale',
  A: 'Award',
  F: 'Tax withholding',
  M: 'Option exercise',
  G: 'Gift',
  C: 'Conversion',
  J: 'Other',
  D: 'Disposition',
  I: 'Discretionary',
  X: 'Exercise',
  W: 'Warrant exercise',
  Z: 'Trust distribution',
};

function roleFromOwner(ownerBlock, relationshipBlock) {
  const title = tagValue(relationshipBlock, 'officerTitle');
  if (title) return title;
  const parts = [];
  if (tagFlag(relationshipBlock, 'isDirector')) parts.push('Director');
  if (tagFlag(relationshipBlock, 'isTenPercentOwner')) parts.push('10% Owner');
  if (tagFlag(relationshipBlock, 'isOfficer')) parts.push('Officer');
  if (tagFlag(relationshipBlock, 'isOther')) parts.push('Other');
  return parts.length ? parts.join(', ') : 'Insider';
}

// Parse one ownership XML document into trade rows.
// meta: { accession, filingDate, filingUrl, amended }
function parseOwnership(xml, meta) {
  const issuerBlock = (xml.match(/<issuer>([\s\S]*?)<\/issuer>/) || [])[1] || '';
  const ownerBlock = (xml.match(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/) || [])[1] || '';
  const relBlock = (ownerBlock.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/) || [])[1] || '';

  const company = tagValue(issuerBlock, 'issuerName') || '';
  const ticker = tagValue(issuerBlock, 'issuerTradingSymbol') || '';
  const insider = tagValue(ownerBlock, 'rptOwnerName') || '';
  const role = roleFromOwner(ownerBlock, relBlock);

  const trades = [];
  const table = (xml.match(/<nonDerivativeTable>([\s\S]*?)<\/nonDerivativeTable>/) || [])[1] || '';
  const blocks = table.match(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g) || [];

  blocks.forEach((block, idx) => {
    const code = tagValue(block, 'transactionCode');
    if (!code) return;
    const shares = toNum(tagValue(block, 'transactionShares'));
    if (shares == null || shares <= 0) return;
    const price = toNum(tagValue(block, 'transactionPricePerShare')) || 0;
    const ownedAfter = toNum(tagValue(block, 'sharesOwnedFollowingTransaction'));
    const tradeDate = tagValue(block, 'transactionDate');

    // Ownership change: reconstruct shares held before the trade.
    // Acquired (P, A, M, C, ...): before = after - shares.
    // Disposed (S, F, G, D, ...): before = after + shares.
    const disposed = code === 'S' || code === 'F' || code === 'G' || code === 'D';
    let pctChange = null;
    if (ownedAfter != null) {
      const before = disposed ? ownedAfter + shares : ownedAfter - shares;
      if (before > 0) {
        pctChange = (disposed ? -shares / before : shares / before) * 100;
      }
    }

    trades.push({
      id: (meta.accession || 'filing') + '-' + idx,
      accession: meta.accession || null,
      filingDate: meta.filingDate || null,
      tradeDate: tradeDate,
      ticker,
      company,
      insider,
      role,
      type: code,
      typeLabel: TYPE_LABELS[code] || code,
      price,
      shares,
      value: shares * price,
      ownedAfter,
      pctChange,
      filingUrl: meta.filingUrl || null,
      amended: !!meta.amended,
    });
  });

  return trades;
}

module.exports = { parseOwnership, TYPE_LABELS };
