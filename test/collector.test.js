'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const collectorPath = path.join(__dirname, '..', 'collector.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-test-'));
const dbPath = path.join(tempDir, 'opencode.db');
const model = { providerID: 'opencode', id: 'deepseek-v4.1-flash' };
const tokens = { input: 1e6, output: 1e6, reasoning: 0, cache: { read: 0, write: 0 } };

let child = null;
let port = 0;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: options.method || 'GET',
        headers: { Authorization: 'Bearer test-token', ...(options.headers || {}) },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const now = Date.now();
  db.prepare('INSERT INTO session_v2 (id, title) VALUES (?, ?)').run('session-1', 'Fixture session');
  db.prepare(
    'INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, ?, ?, ?)'
  ).run(
    'message-1',
    'session-1',
    'assistant',
    now - 1000,
    JSON.stringify({ model, tokens, cost: 0, agent: 'build' })
  );
  db.close();

  child = spawn(process.execPath, [collectorPath], {
    env: { ...process.env, OPENCODE_DB: dbPath, MONITOR_PORT: '0', MONITOR_TOKEN: 'test-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('collector did not start')), 5000);
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split(/\r?\n/).find((item) => item.startsWith('MONITOR_READY '));
      if (!line) return;
      clearTimeout(timer);
      const info = JSON.parse(line.slice('MONITOR_READY '.length));
      resolve(info.port);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('collector exited with code ' + code));
    });
  });
});

after(() => {
  if (child) child.kill();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

test('summary aggregates the fixture and includes a month-to-date estimate', async () => {
  const response = await request('/api/summary?range=today');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.range, 'today');
  assert.equal(body.totals.sessions, 1);
  assert.equal(body.totals.input, 1e6);
  assert.equal(body.totals.output, 1e6);
  assert.equal(body.models.length, 1);
  assert.ok(Math.abs(body.models[0].estimate - 0.75) < 1e-9);
  assert.ok(Math.abs(body.models[0].monthlyEstimate - 0.75) < 1e-9);
  assert.equal(body.models[0].limit, 80);
});

test('activity returns usage fields without paths or session identifiers', async () => {
  const response = await request('/api/activity?limit=5');
  const rows = JSON.parse(response.body);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Fixture session');
  assert.equal(rows[0].model, 'deepseek-v4.1-flash');
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ['cacheRead', 'cost', 'input', 'model', 'output', 'reasoning', 'time', 'title'].sort()
  );
  assert.equal('directory' in rows[0], false);
  assert.equal('sessionID' in rows[0], false);
});

test('the UI is same-origin, has a CSP, and sends no CORS header', async () => {
  const response = await request('/', { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.ok(response.headers['content-security-policy']);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('non-loopback Host headers are rejected', async () => {
  const response = await request('/api/health', { headers: { Host: 'evil.example' } });
  assert.equal(response.status, 403);
});

test('API requests require the per-launch bearer token', async () => {
  const missing = await request('/api/health', { headers: { Authorization: '' } });
  assert.equal(missing.status, 401);
  const wrong = await request('/api/health', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(wrong.status, 401);
});

test('path traversal and non-GET methods are rejected', async () => {
  const traversal = await request('/%2e%2e/package.json');
  assert.ok([403, 404].includes(traversal.status));

  const post = await request('/api/health', { method: 'POST' });
  assert.equal(post.status, 405);
});

test('health reports the database without exposing its path', async () => {
  const response = await request('/api/health');
  const body = JSON.parse(response.body);
  assert.equal(body.database.ok, true);
  assert.equal(body.database.sessionTable, 'session_v2');
  assert.equal(JSON.stringify(body).includes(tempDir), false);
});
