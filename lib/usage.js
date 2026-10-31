'use strict';

const pricing = require('./pricing.json');

const RANGES = new Set(['today', '7d', '30d']);
const RANGE_DAYS = { today: 0, '7d': 6, '30d': 29 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function modelIdOf(key) {
  const afterProvider = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
  return afterProvider.split(':')[0];
}

function modelKey(model) {
  if (!model || !model.id) return 'unknown';
  const provider = model.providerID || '';
  const variant = model.variant ? ':' + model.variant : '';
  return (provider ? provider + '/' : '') + model.id + variant;
}

function shortModel(key) {
  if (!key || key === 'unknown') return 'unknown';
  return key.split('/').pop();
}

function priceOf(key) {
  return pricing.models[modelIdOf(key)] || null;
}

function limitOf(key) {
  const p = priceOf(key);
  return p ? p.limit : 0;
}

function estimateCost(key, tok) {
  const p = priceOf(key);
  if (!p) return 0;
  const per = (x) => (x || 0) / 1e6;
  return (
    per(tok.input) * p.in +
    per(tok.output) * p.out +
    per(tok.reasoning) * p.out +
    per(tok.cache && tok.cache.read) * p.cache +
    per(tok.cache && tok.cache.write) * (p.cacheWrite || p.in)
  );
}

function sanitizeRange(value) {
  return RANGES.has(value) ? value : 'today';
}

function rangeStart(range, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (RANGE_DAYS[range] || 0));
  return d.getTime();
}

function monthStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

function localDateKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function bucketKey(ts, range) {
  const d = new Date(ts);
  if (range === 'today') return pad2(d.getHours());
  return localDateKey(ts);
}

function dayLabels(range, now = new Date()) {
  if (range === 'today') {
    return Array.from({ length: 24 }, (_, i) => pad2(i));
  }
  const count = range === '7d' ? 7 : 30;
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(localDateKey(d.getTime()));
  }
  return out;
}

function emptyTotals() {
  return { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
}

function addTo(totals, tok, cost) {
  totals.cost += typeof cost === 'number' ? cost : 0;
  const x = tok || {};
  totals.input += x.input || 0;
  totals.output += x.output || 0;
  totals.reasoning += x.reasoning || 0;
  totals.cacheRead += (x.cache && x.cache.read) || 0;
  totals.cacheWrite += (x.cache && x.cache.write) || 0;
  totals.messages += 1;
}

function tokenTotal(t) {
  return (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cacheRead || 0);
}

module.exports = {
  pricing,
  RANGES,
  modelIdOf,
  modelKey,
  shortModel,
  limitOf,
  estimateCost,
  sanitizeRange,
  rangeStart,
  monthStart,
  localDateKey,
  bucketKey,
  dayLabels,
  emptyTotals,
  addTo,
  tokenTotal,
};
