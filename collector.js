'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const usage = require('./lib/usage');
const pkg = require('./package.json');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // Reported through /api/health when the runtime lacks node:sqlite.
}

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.MONITOR_PORT || '0', 10) || 0;
const UI_DIR = path.join(__dirname, 'ui');
const DB_PATH = process.env.OPENCODE_DB || defaultDbPath();
const SUMMARY_TTL_MS = 7000;

function defaultDbPath() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// ---------------------------------------------------------------------------
// Database (read-only)

let db = null;
let dbError = null;
let sessionTable = null;

function connect() {
  if (db) return db;
  if (!DatabaseSync) throw new Error('node:sqlite is not available in this runtime');
  if (!fs.existsSync(DB_PATH)) throw new Error('OpenCode database not found at ' + DB_PATH);
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000');
    db.exec('PRAGMA query_only = 1');
    sessionTable = detectSessionTable(db);
    dbError = null;
    return db;
  } catch (e) {
    db = null;
    dbError = String((e && e.message) || e);
    throw e;
  }
}

function detectSessionTable(conn) {
  const rows = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session_v2', 'session')")
    .all();
  const names = new Set(rows.map((r) => r.name));
  if (names.has('session_v2')) return 'session_v2';
  if (names.has('session')) return 'session';
  return null;
}

// Only the usage fields leave SQLite. The message JSON may contain prompts,
// tool output and file contents; none of that is read into this process.
const PARSED_FIELDS = `
  json_extract(data, '$.model.providerID') AS provider,
  json_extract(data, '$.model.id') AS model_id,
  json_extract(data, '$.model.variant') AS variant,
  json_extract(data, '$.tokens.input') AS input,
  json_extract(data, '$.tokens.output') AS output,
  json_extract(data, '$.tokens.reasoning') AS reasoning,
  json_extract(data, '$.tokens.cache.read') AS cache_read,
  json_extract(data, '$.tokens.cache.write') AS cache_write,
  json_extract(data, '$.cost') AS cost
`;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToUsage(row) {
  return {
    sessionID: row.session_id,
    time: row.time_created,
    model: {
      providerID: row.provider || '',
      id: row.model_id || '',
      variant: row.variant || '',
    },
    tokens: {
      input: number(row.input),
      output: number(row.output),
      reasoning: number(row.reasoning),
      cache: {
        read: number(row.cache_read),
        write: number(row.cache_write),
      },
    },
    cost: number(row.cost),
  };
}

function loadMessages(fromMs) {
  return connect()
    .prepare(
      `WITH parsed AS (
         SELECT session_id, time_created, ${PARSED_FIELDS}
         FROM session_message
         WHERE type = 'assistant' AND time_created >= ? AND json_valid(data)
       )
       SELECT * FROM parsed ORDER BY time_created ASC`
    )
    .all(fromMs);
}

let monthlyCache = { at: 0, data: null };

function monthlyEstimates() {
  if (monthlyCache.data && Date.now() - monthlyCache.at < 60000) return monthlyCache.data;
  const rows = connect()
    .prepare(
      `WITH parsed AS (
         SELECT ${PARSED_FIELDS}
         FROM session_message
         WHERE type = 'assistant' AND time_created >= ? AND json_valid(data)
       )
       SELECT
         provider, model_id, variant,
         COALESCE(SUM(input), 0) AS input,
         COALESCE(SUM(output), 0) AS output,
         COALESCE(SUM(reasoning), 0) AS reasoning,
         COALESCE(SUM(cache_read), 0) AS cache_read,
         COALESCE(SUM(cache_write), 0) AS cache_write
       FROM parsed
       GROUP BY provider, model_id, variant`
    )
    .all(usage.monthStart());

  const map = new Map();
  for (const row of rows) {
    const key = usage.modelKey({ providerID: row.provider, id: row.model_id, variant: row.variant });
    const estimate = usage.estimateCost(key, {
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cache: { read: row.cache_read, write: row.cache_write },
    });
    map.set(key, (map.get(key) || 0) + estimate);
  }

  monthlyCache = { at: Date.now(), data: map };
  return map;
}

const summaryCache = new Map();

function summary(range) {
  const safeRange = usage.sanitizeRange(range);
  const cached = summaryCache.get(safeRange);
  if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.payload;

  const from = usage.rangeStart(safeRange);
  const rows = loadMessages(from);
  const monthly = monthlyEstimates();
  const totals = usage.emptyTotals();
  totals.estimate = 0;
  const buckets = new Map();
  const sessions = new Set();
  const models = new Map();

  for (const row of rows) {
    const message = rowToUsage(row);
    usage.addTo(totals, message.tokens, message.cost);
    const mk = usage.modelKey(message.model);
    const estimate = usage.estimateCost(mk, message.tokens);
    totals.estimate += estimate;
    sessions.add(row.session_id);

    const key = usage.bucketKey(message.time, safeRange);
    if (!buckets.has(key)) buckets.set(key, { cost: 0, tokens: 0, messages: 0 });
    const bucket = buckets.get(key);
    bucket.cost += message.cost;
    bucket.messages += 1;
    bucket.tokens += usage.tokenTotal(message.tokens);

    if (!models.has(mk)) {
      models.set(mk, {
        model: mk,
        label: usage.shortModel(mk),
        totals: usage.emptyTotals(),
        estimate: 0,
        monthlyEstimate: 0,
        limit: usage.limitOf(mk),
      });
    }
    const entry = models.get(mk);
    usage.addTo(entry.totals, message.tokens, message.cost);
    entry.estimate += estimate;
  }

  for (const [key, entry] of models) {
    entry.monthlyEstimate = monthly.get(key) || 0;
  }

  const labels = usage.dayLabels(safeRange);

  const payload = {
    range: safeRange,
    from,
    generatedAt: Date.now(),
    totals: { ...totals, sessions: sessions.size },
    series: labels.map((label) => ({ label, ...(buckets.get(label) || { cost: 0, tokens: 0, messages: 0 }) })),
    models: [...models.values()]
      .filter((m) => usage.tokenTotal(m.totals) > 0 || m.totals.cost > 0)
      .sort((a, b) => usage.tokenTotal(b.totals) - usage.tokenTotal(a.totals)),
  };

  summaryCache.set(safeRange, { at: Date.now(), payload });
  return payload;
}

function activity(limit) {
  const conn = connect();
  const count = Math.min(100, Math.max(1, Number(limit) || 30));
  const join = sessionTable ? ` LEFT JOIN ${sessionTable} s ON s.id = p.session_id` : '';
  const title = sessionTable ? 's.title' : 'NULL AS title';
  const rows = conn
    .prepare(
      `WITH parsed AS (
         SELECT session_id, time_created, ${PARSED_FIELDS}
         FROM session_message
         WHERE type = 'assistant' AND json_valid(data)
       )
       SELECT p.time_created, p.session_id, p.provider, p.model_id, p.variant,
              p.input, p.output, p.reasoning, p.cache_read, p.cache_write, p.cost, ${title}
       FROM parsed p${join}
       ORDER BY p.time_created DESC
       LIMIT ?`
    )
    .all(count);

  return rows.map((row) => {
    const message = rowToUsage(row);
    return {
      title: String(row.title || '').slice(0, 300),
      time: message.time,
      model: usage.shortModel(usage.modelKey(message.model)),
      cost: message.cost,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
    };
  });
}

function live() {
  const conn = connect();
  const last = conn
    .prepare(
      `WITH parsed AS (
         SELECT session_id, time_created, ${PARSED_FIELDS}
         FROM session_message
         WHERE type = 'assistant' AND json_valid(data)
       )
       SELECT * FROM parsed ORDER BY time_created DESC LIMIT 1`
    )
    .get();
  const today = summary('today').totals;
  const message = last ? rowToUsage(last) : null;
  const age = last ? Date.now() - last.time_created : null;
  return {
    serverTime: Date.now(),
    lastMessageAt: last ? last.time_created : null,
    active: age !== null && age < 120000,
    model: message ? usage.shortModel(usage.modelKey(message.model)) : 'unknown',
    tokens: message ? message.tokens : null,
    cost: message ? message.cost : 0,
    today,
  };
}

// ---------------------------------------------------------------------------
// OpenCode limits (via the local CLI, never the network)

let cliCache = null;
let limitsCache = { at: 0, payload: null, error: null };

function pathLookup(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

function findCli() {
  if (process.env.OPENCODE_CLI) {
    if (fs.existsSync(process.env.OPENCODE_CLI)) return process.env.OPENCODE_CLI;
    return null;
  }
  if (cliCache && fs.existsSync(cliCache)) return cliCache;

  const candidates = [];
  const localApp = process.env.LOCALAPPDATA || '';
  const roaming = process.env.APPDATA || '';
  if (process.platform === 'win32') {
    candidates.push(
      path.join(localApp, 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe'),
      path.join(localApp, 'Programs', '@opencodedesktop', 'resources', 'opencode-cli.exe')
    );
    const versioned = path.join(roaming, 'ai.opencode.desktop', 'cli');
    try {
      const dirs = fs
        .readdirSync(versioned)
        .filter((d) => fs.existsSync(path.join(versioned, d, 'opencode-cli.exe')))
        .sort()
        .reverse();
      if (dirs.length) candidates.push(path.join(versioned, dirs[0], 'opencode-cli.exe'));
    } catch {
      // not installed via the desktop app
    }
  }
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
      '/Applications/OpenCode.app/Contents/MacOS/opencode-cli',
      path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
      '/opt/homebrew/bin/opencode',
      '/usr/local/bin/opencode'
    );
  }
  candidates.push(path.join(os.homedir(), '.opencode', 'bin', 'opencode'));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      cliCache = candidate;
      return candidate;
    }
  }
  const found = pathLookup(['opencode-cli', 'opencode']);
  if (found) cliCache = found;
  return found;
}

function sanitizeLimits(parsed) {
  const data = parsed && parsed.data ? parsed.data : parsed;
  const go = data && data.go ? data.go : null;
  const workspace = data && data.workspace
    ? { name: data.workspace.name || '', url: data.workspace.usageURL || '' }
    : null;
  return { go, workspace, fetchedAt: Date.now() };
}

function fetchLimits(force) {
  const now = Date.now();
  if (!force && limitsCache.payload && now - limitsCache.at < 25000) return Promise.resolve(limitsCache);

  const bin = findCli();
  if (!bin) {
    limitsCache = {
      at: now,
      payload: limitsCache.payload,
      error: 'OpenCode CLI not found (set OPENCODE_CLI to its path)',
    };
    return Promise.resolve(limitsCache);
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  return new Promise((resolve) => {
    execFile(
      bin,
      ['api', 'get', '/api/experimental/usage/limits'],
      { timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env },
      (err, stdout) => {
        if (err) {
          const timedOut = err.killed || /timed? ?out/i.test(String(err.message || ''));
          limitsCache = {
            at: now,
            payload: limitsCache.payload,
            error: timedOut ? 'OpenCode CLI timed out' : 'OpenCode CLI request failed',
          };
          return resolve(limitsCache);
        }
        try {
          const parsed = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
          const next = { at: Date.now(), payload: sanitizeLimits(parsed), error: null };
          limitsCache = next;
          resolve(next);
        } catch {
          limitsCache = { at: now, payload: limitsCache.payload, error: 'Could not parse OpenCode CLI response' };
          resolve(limitsCache);
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// HTTP server (loopback only, same-origin UI, no CORS)

function baseHeaders(extra) {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra,
  };
}

function json(res, code, body) {
  res.writeHead(code, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return json(res, 400, { error: 'bad path' });
  }
  rel = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const file = path.resolve(UI_DIR, rel);
  if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) {
    return json(res, 403, { error: 'forbidden' });
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = baseHeaders({ 'Content-Type': type });
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function validHostHeader(req) {
  const port = server.address() && server.address().port;
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return allowed.has(String(req.headers.host || ''));
}

const server = http.createServer(async (req, res) => {
  if (!validHostHeader(req)) return json(res, 403, { error: 'bad host' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, baseHeaders({ Allow: 'GET, HEAD' }));
    return res.end();
  }

  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/ping') {
      return json(res, 200, { ok: true, version: pkg.version, pid: process.pid });
    }
    if (url.pathname === '/api/health') {
      let database = { ok: true, sessionTable };
      if (!db) {
        try {
          connect();
          database = { ok: true, sessionTable };
        } catch (e) {
          const message = String((e && e.message) || e);
          console.error('[collector]', message);
          database = { ok: false, error: /not found/i.test(message) ? 'not found' : 'unavailable' };
        }
      }
      return json(res, 200, {
        ok: true,
        version: pkg.version,
        database,
        limits: { ok: !limitsCache.error, error: limitsCache.error },
      });
    }
    if (url.pathname === '/api/limits') {
      const result = await fetchLimits(false);
      return json(res, 200, {
        ...(result.payload || { go: null, workspace: null }),
        error: result.error || null,
      });
    }
    if (url.pathname === '/api/summary') {
      return json(res, 200, summary(url.searchParams.get('range') || 'today'));
    }
    if (url.pathname === '/api/activity') {
      return json(res, 200, activity(url.searchParams.get('limit')));
    }
    if (url.pathname === '/api/live') {
      return json(res, 200, live());
    }
    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'not found' });
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    db = null;
    const message = String((e && e.message) || e);
    console.error('[collector]', message);
    return json(res, 500, { error: 'database unavailable' });
  }
});

server.on('error', (e) => {
  console.error('[collector] server error:', e && e.message ? e.message : e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const actual = server.address().port;
  process.stdout.write('MONITOR_READY ' + JSON.stringify({ port: actual, version: pkg.version }) + '\n');
  // Warm the summary and month-to-date caches while the window is loading.
  setTimeout(() => {
    try { summary('today'); } catch {}
  }, 200);
});

function shutdown() {
  try {
    server.close();
  } catch {}
  try {
    if (db) db.close();
  } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
