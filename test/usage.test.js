'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../lib/usage');

test('modelIdOf strips provider prefix and variant suffix', () => {
  assert.equal(usage.modelIdOf('opencode/deepseek-v4.1-flash:max'), 'deepseek-v4.1-flash');
  assert.equal(usage.modelIdOf('deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
  assert.equal(usage.modelIdOf('a/b/c'), 'b/c');
});

test('modelKey keeps provider and variant, shortModel drops them', () => {
  const key = usage.modelKey({ providerID: 'opencode', id: 'kimi-k3', variant: 'fast' });
  assert.equal(key, 'opencode/kimi-k3:fast');
  assert.equal(usage.shortModel(key), 'kimi-k3:fast');
  assert.equal(usage.modelKey(null), 'unknown');
  assert.equal(usage.shortModel('unknown'), 'unknown');
});

test('estimateCost uses input, output, reasoning and cache prices', () => {
  const cost = usage.estimateCost('opencode/deepseek-v4.1-flash', {
    input: 1e6,
    output: 1e6,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  });
  assert.ok(Math.abs(cost - 0.75) < 1e-9, String(cost));

  const cached = usage.estimateCost('deepseek-v4.1-flash', { cache: { read: 1e6 } });
  assert.ok(Math.abs(cached - 0.003) < 1e-9, String(cached));

  assert.equal(usage.estimateCost('unknown/model', { input: 1e6 }), 0);
});

test('limitOf returns the monthly cap for known models only', () => {
  assert.equal(usage.limitOf('opencode/deepseek-v4.1-flash'), 80);
  assert.equal(usage.limitOf('openai/gpt-4'), 0);
});

test('localDateKey uses the local calendar date, not UTC', () => {
  const localLate = new Date(2026, 0, 5, 23, 30, 0);
  assert.equal(usage.localDateKey(localLate.getTime()), '2026-01-05');
});

test('bucketKey pads hours and groups days locally', () => {
  const date = new Date(2026, 0, 5, 9, 5, 0);
  assert.equal(usage.bucketKey(date.getTime(), 'today'), '09');
  assert.equal(usage.bucketKey(date.getTime(), '7d'), '2026-01-05');
  assert.equal(usage.bucketKey(date.getTime(), '30d'), '2026-01-05');
});

test('dayLabels returns ordered local labels including today', () => {
  const now = new Date(2026, 0, 31, 12, 0, 0);
  const week = usage.dayLabels('7d', now);
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-01-25');
  assert.equal(week[6], '2026-01-31');
  assert.equal(new Set(week).size, 7);

  const month = usage.dayLabels('30d', now);
  assert.equal(month.length, 30);
  assert.equal(month[29], '2026-01-31');

  assert.equal(usage.dayLabels('today', now).length, 24);
  assert.equal(usage.dayLabels('today', now)[0], '00');
  assert.equal(usage.dayLabels('today', now)[23], '23');
});

test('rangeStart starts at local midnight', () => {
  const now = new Date(2026, 0, 31, 18, 45, 0);
  const today = new Date(usage.rangeStart('today', now));
  assert.equal(today.getHours(), 0);
  assert.equal(today.getMinutes(), 0);
  assert.equal(today.getDate(), 31);

  const week = new Date(usage.rangeStart('7d', now));
  assert.equal(week.getDate(), 25);
  assert.equal(week.getMonth(), 0);
});

test('monthStart starts at local midnight on the first day of the month', () => {
  const now = new Date(2026, 9, 31, 18, 45, 0);
  const start = new Date(usage.monthStart(now));
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 9);
  assert.equal(start.getDate(), 1);
  assert.equal(start.getHours(), 0);
});

test('sanitizeRange rejects unknown values', () => {
  assert.equal(usage.sanitizeRange('7d'), '7d');
  assert.equal(usage.sanitizeRange('all'), 'today');
  assert.equal(usage.sanitizeRange(undefined), 'today');
});

test('tokenTotal adds only billable token fields', () => {
  assert.equal(usage.tokenTotal({ input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 100 }), 20);
  assert.equal(usage.tokenTotal({}), 0);
});

test('pricing file exposes the current model table', () => {
  assert.equal(usage.pricing.currency, 'USD');
  assert.ok(Object.keys(usage.pricing.models).length >= 20);
});
