'use strict';

const { t, locale } = window.I18N;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const SERVED = location.protocol === 'http:' || location.protocol === 'https:';
const API = SERVED ? location.origin : 'http://127.0.0.1:20177';

const state = {
  range: 'today',
  tab: 'models',
  mini: params.get('mini') === '1',
  pinned: true,
  limits: null,
  limitsError: null,
  consoleUrl: 'https://opencode.ai/console',
  online: true,
  dbOk: true,
  token: null,
  notifications: true,
};

const $ = (id) => document.getElementById(id);

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function fmtCost(n) {
  const value = Number(n) || 0;
  if (value === 0) return '$0.000';
  if (value < 0.001) return '$' + value.toFixed(5);
  if (value < 1) return '$' + value.toFixed(3);
  return '$' + value.toFixed(2);
}

function fmtTime(ts) {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return time;
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

function fmtReset(ts) {
  if (!ts) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return t('reset.soon');
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.round((diff % 3600000) / 60000);
  if (hours < 24) return t('reset.in', { h: hours, m: minutes });
  const date = new Date(ts);
  return t('reset.at', {
    date: date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
    time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
  });
}

function count(n, oneKey, manyKey) {
  return t(n === 1 ? oneKey : manyKey, { n: fmtNum(n) });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function get(path) {
  if (DEMO) return demoGet(path);
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const response = await fetch(API + path, { cache: 'no-store', headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // keep the status-based error below
  }
  if (!response.ok) {
    const error = new Error(data.error || 'HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

function updateBanner() {
  let message = '';
  if (DEMO) message = t('banner.demo');
  else if (!state.online) message = t('banner.offline');
  else if (!state.dbOk) message = t('banner.db');
  else if (state.limitsError) message = t('banner.limits', { error: state.limitsError });
  const banner = $('banner');
  banner.textContent = message;
  banner.classList.toggle('hidden', !message);
  banner.classList.toggle('demo', DEMO);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs button').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('tabModels').classList.toggle('hidden', tab !== 'models');
  $('tabActivity').classList.toggle('hidden', tab !== 'activity');
}

function meterClass(percent) {
  if (percent >= 85) return 'hot';
  if (percent >= 60) return 'warn';
  return '';
}

function renderLimitRow(id, obj) {
  const el = $(id);
  if (!el) return 0;
  const bar = el.querySelector('.lim-bar i');
  const value = el.querySelector('.lim-val');
  const reset = el.querySelector('.lim-reset');
  if (!obj) {
    value.textContent = '—';
    reset.textContent = t('limits.empty');
    bar.style.width = '0%';
    return 0;
  }
  const percent = Math.round(Math.max(0, Math.min(100, Number(obj.percent) || 0)));
  value.textContent = percent + '%';
  value.style.color = obj.limited ? 'var(--hot)' : '';
  bar.style.width = percent + '%';
  bar.className = meterClass(percent);
  reset.textContent = (obj.limited ? t('limits.limited') : '') + fmtReset(obj.resetsAt);
  return percent;
}

function renderLimits(payload) {
  const data = payload || {};
  const go = data.go;
  if (!go) {
    ['limRolling', 'limWeekly', 'limMonthly'].forEach((id) => renderLimitRow(id, null));
    $('limitsWorkspace').textContent = '';
    return;
  }
  state.limits = go;
  if (data.workspace && data.workspace.url) state.consoleUrl = data.workspace.url;
  $('limitsWorkspace').textContent = (data.workspace && data.workspace.name) || '';
  renderLimitRow('limRolling', go.rolling);
  renderLimitRow('limWeekly', go.weekly);
  renderLimitRow('limMonthly', go.monthly);
  notifyLimits(go);
}

function notifyLimits(go) {
  if (DEMO || !state.notifications || !window.monitor || !window.monitor.notify) return;
  const limits = [
    ['rolling', go.rolling],
    ['weekly', go.weekly],
    ['monthly', go.monthly],
  ];
  for (const [name, limit] of limits) {
    if (!limit || !limit.resetsAt) continue;
    const percent = Number(limit.percent) || 0;
    const level = percent >= 95 ? 'critical' : percent >= 80 ? 'warning' : null;
    if (!level) continue;
    const key = 'ocm:notify:' + name + ':' + limit.resetsAt + ':' + level;
    try {
      if (localStorage.getItem(key)) continue;
      localStorage.setItem(key, '1');
    } catch {
      // notifications still work without storage; they may repeat after a restart
    }
    window.monitor
      .notify(
        t('notify.title', { level: t(level === 'critical' ? 'notify.critical' : 'notify.warning') }),
        t('notify.body', { name: t('limits.' + name), percent: Math.round(percent) })
      )
      .catch(() => {});
  }
}

function renderSummary(summary) {
  const totals = summary.totals || {};
  const total = (totals.input || 0) + (totals.output || 0) + (totals.reasoning || 0) + (totals.cacheRead || 0);
  const hasRealCost = (totals.cost || 0) > 0;
  $('cost').textContent = fmtCost(hasRealCost ? totals.cost : totals.estimate || 0);
  $('costLabel').textContent = hasRealCost ? t('hero.spend') : t('hero.estimate');
  $('tokens').textContent = fmtNum(total);
  $('stInput').textContent = fmtNum(totals.input);
  $('stOutput').textContent = fmtNum(totals.output);
  $('stCache').textContent = fmtNum(totals.cacheRead);
  $('stSessions').textContent = String(totals.sessions || 0);

  const bars = $('bars');
  bars.innerHTML = '';
  const series = Array.isArray(summary.series) ? summary.series : [];
  const max = Math.max(1, ...series.map((point) => point.tokens || 0));
  series.forEach((point) => {
    const bar = document.createElement('div');
    bar.className = 'bar' + (point.tokens >= max * 0.85 && point.tokens > 0 ? ' peak' : '');
    bar.style.height = Math.max(2, Math.round(((point.tokens || 0) / max) * 42)) + 'px';
    bar.title = point.label + ': ' + fmtNum(point.tokens) + ' · ' + (point.messages || 0);
    bars.appendChild(bar);
  });
  $('chartLeft').textContent = series.length ? series[0].label : '';
  $('chartRight').textContent = series.length ? series[series.length - 1].label : '';

  const models = Array.isArray(summary.models) ? summary.models : [];
  $('tabModels').innerHTML = models.length
    ? models
        .slice(0, 40)
        .map((model) => {
          const tokens = (model.totals.input || 0) + (model.totals.output || 0) + (model.totals.reasoning || 0) + (model.totals.cacheRead || 0);
          const monthly = Number.isFinite(model.monthlyEstimate) ? model.monthlyEstimate : model.estimate;
          const percent = model.limit ? Math.min(100, Math.max(2, Math.round((monthly / model.limit) * 100))) : 0;
          const spent = model.totals.cost > 0 ? model.totals.cost : model.estimate;
          const money = model.limit
            ? fmtCost(spent) + '<small>' + t('models.ofBudget', { limit: '$' + model.limit }) + '</small>'
            : fmtCost(model.totals.cost || 0) + '<small>' + t('models.free') + '</small>';
          return (
            '<div class="row"><div class="grow"><div class="title">' +
            escapeHtml(model.label) +
            '</div><div class="meta">' +
            count(model.totals.messages, 'models.messagesOne', 'models.messages') +
            ' · ' +
            count(tokens, 'models.tokensOne', 'models.tokens') +
            (model.limit ? ' · ' + t('models.ofLimit', { p: Math.round((monthly / model.limit) * 100) }) : '') +
            '</div><div class="bar-mini"><i style="width:' +
            percent +
            '%"></i></div></div><div class="num">' +
            money +
            '</div></div>'
          );
        })
        .join('')
    : '<div class="empty">' + t('models.empty') + '</div>';

  $('updated').textContent = t('footer.updated', {
    time: new Date(summary.generatedAt || Date.now()).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });
}

function renderActivity(rows) {
  rows = Array.isArray(rows) ? rows : [];
  $('tabActivity').innerHTML = rows.length
    ? rows
        .map((row) => {
          const tokens = (row.input || 0) + (row.output || 0) + (row.reasoning || 0) + (row.cacheRead || 0);
          return (
            '<div class="row"><div class="grow"><div class="title">' +
            escapeHtml(row.title || t('activity.untitled')) +
            '</div><div class="meta">' +
            fmtTime(row.time) +
            ' · ' +
            escapeHtml(row.model) +
            ' · ' +
            fmtNum(tokens) +
            ' tok</div></div><div class="num">' +
            fmtCost(row.cost) +
            '</div></div>'
          );
        })
        .join('')
    : '<div class="empty">' + t('activity.empty') + '</div>';
}

function renderLive(live) {
  $('liveDot').classList.toggle('live', !!live.active);
}

async function refresh() {
  try {
    const [summary, activity, live] = await Promise.all([
      get('/api/summary?range=' + state.range),
      get('/api/activity?limit=40'),
      get('/api/live'),
    ]);
    state.online = true;
    state.dbOk = true;
    renderSummary(summary);
    renderActivity(activity);
    renderLive(live);
  } catch (error) {
    if (error instanceof TypeError) {
      state.online = false;
    } else if (error.status === 500) {
      state.dbOk = false;
    }
  }
  updateBanner();
}

async function refreshLimits() {
  try {
    const limits = await get('/api/limits');
    state.limitsError = limits.error || null;
    renderLimits(limits);
  } catch (error) {
    state.limitsError = String(error.message || error);
    renderLimits(null);
  }
  updateBanner();
}

function applyMiniState(value) {
  state.mini = !!value;
  document.body.classList.toggle('mini', state.mini);
  $('btnMini').classList.toggle('on', state.mini);
}

async function setMiniMode(value) {
  applyMiniState(value);
  if (window.monitor) await window.monitor.mini(state.mini);
}

async function applySettings() {
  if (!window.monitor) {
    applyMiniState(state.mini);
    return;
  }
  try {
    const settings = await window.monitor.settings();
    state.pinned = !!settings.pinned;
    state.notifications = settings.notifications !== false;
    $('btnPin').classList.toggle('on', state.pinned);
    applyMiniState(settings.mini);
  } catch {
    // defaults are fine
  }
  if (window.monitor.onMini) window.monitor.onMini(applyMiniState);
  if (window.monitor.onNotifications) {
    window.monitor.onNotifications((value) => {
      state.notifications = !!value;
    });
  }
}

function openConsole() {
  if (window.monitor) window.monitor.openConsole(state.consoleUrl);
  else window.open(state.consoleUrl, '_blank', 'noopener');
}

function bind() {
  document.querySelectorAll('#ranges button').forEach((button) =>
    button.addEventListener('click', () => {
      document.querySelectorAll('#ranges button').forEach((item) => item.classList.toggle('active', item === button));
      state.range = button.dataset.range;
      refresh();
    })
  );
  document.querySelectorAll('#tabs button').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));

  $('btnPin').addEventListener('click', async () => {
    state.pinned = !state.pinned;
    $('btnPin').classList.toggle('on', state.pinned);
    if (window.monitor) await window.monitor.pin(state.pinned);
  });
  $('btnMini').addEventListener('click', () => setMiniMode(!state.mini));
  $('btnExpand').addEventListener('click', () => setMiniMode(false));
  $('btnClose').addEventListener('click', () => {
    if (window.monitor) window.monitor.close();
  });
  $('btnMiniClose').addEventListener('click', () => {
    if (window.monitor) window.monitor.close();
  });
  $('btnConsole').addEventListener('click', openConsole);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && window.monitor) window.monitor.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refresh();
      refreshLimits();
    }
  });
}

// ---------------------------------------------------------------------------
// Demo mode: lets contributors and README screenshots run without OpenCode.

function demoHours() {
  return Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
}

function demoDays(count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    out.push(date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'));
  }
  return out;
}

function demoSummary(range) {
  const labels = range === 'today' ? demoHours() : demoDays(range === '7d' ? 7 : 30);
  const series = labels.map((label, index) => {
    const active = range === 'today' ? index >= 8 && index <= 21 : index % 3 !== 0;
    const tokens = active ? 45000 + ((index * 7919) % 160000) : 0;
    const messages = active ? 2 + ((index * 3) % 9) : 0;
    return { label, tokens, messages, cost: tokens / 1e6 * 0.9 };
  });
  const sum = (field) => series.reduce((total, point) => total + (point[field] || 0), 0);
  const tokens = sum('tokens');
  const messages = sum('messages');
  const cost = sum('cost');
  return {
    range,
    generatedAt: Date.now(),
    totals: {
      input: Math.round(tokens * 0.62),
      output: Math.round(tokens * 0.18),
      reasoning: Math.round(tokens * 0.05),
      cacheRead: Math.round(tokens * 0.15),
      cacheWrite: 0,
      cost,
      estimate: cost,
      messages,
      sessions: range === 'today' ? 4 : 18,
    },
    series,
    models: [
      { label: 'deepseek-v4.1-flash', limit: 80, estimate: cost * 0.72, monthlyEstimate: 24.8, totals: { input: Math.round(tokens * 0.48), output: Math.round(tokens * 0.13), reasoning: 0, cacheRead: Math.round(tokens * 0.12), cacheWrite: 0, messages: Math.round(messages * 0.68), cost: cost * 0.72 } },
      { label: 'claude-haiku-5-5', limit: 15, estimate: cost * 0.19, monthlyEstimate: 1.8, totals: { input: Math.round(tokens * 0.1), output: Math.round(tokens * 0.04), reasoning: 0, cacheRead: Math.round(tokens * 0.02), cacheWrite: 0, messages: Math.round(messages * 0.22), cost: cost * 0.19 } },
      { label: 'qwen3.8-flash', limit: 30, estimate: cost * 0.09, monthlyEstimate: 1.5, totals: { input: Math.round(tokens * 0.04), output: Math.round(tokens * 0.01), reasoning: 0, cacheRead: Math.round(tokens * 0.01), cacheWrite: 0, messages: Math.round(messages * 0.1), cost: cost * 0.09 } },
    ],
  };
}

function demoGet(path) {
  const url = new URL(path, 'http://demo.local');
  if (url.pathname === '/api/limits') {
    return Promise.resolve({
      go: {
        rolling: { percent: 42, limited: false, resetsAt: Date.now() + 2.4 * 3600000 },
        weekly: { percent: 63, limited: false, resetsAt: Date.now() + 3.2 * 86400000 },
        monthly: { percent: 71, limited: false, resetsAt: Date.now() + 18 * 86400000 },
      },
      workspace: { name: 'Demo workspace', url: 'https://opencode.ai/console' },
      error: null,
    });
  }
  if (url.pathname === '/api/activity') {
    const titles = [
      'Refactor session collector',
      'Add CSV export',
      'Fix timezone bucketing',
      'Polish mini mode',
      'Review pull request #42',
      'Investigate slow query',
      'Update pricing table',
      'Write release notes',
    ];
    return Promise.resolve(
      titles.map((title, index) => ({
        title,
        time: Date.now() - index * 47 * 60000,
        model: index % 2 ? 'claude-haiku-5-5' : 'deepseek-v4.1-flash',
        cost: 0.02 + index * 0.013,
        input: 18000 + index * 2400,
        output: 2200 + index * 300,
        reasoning: 0,
        cacheRead: 7000 + index * 500,
      }))
    );
  }
  if (url.pathname === '/api/live') {
    return Promise.resolve({
      active: true,
      model: 'deepseek-v4.1-flash',
      today: demoSummary('today').totals,
    });
  }
  if (url.pathname === '/api/health') {
    return Promise.resolve({ ok: true, database: { ok: true }, limits: { ok: true } });
  }
  return Promise.resolve(demoSummary(url.searchParams.get('range') || 'today'));
}

(async function init() {
  if (window.I18N) window.I18N.apply();
  bind();
  await applySettings();
  if (window.monitor && window.monitor.token) {
    try {
      state.token = await window.monitor.token();
    } catch {
      state.token = null;
    }
  }
  setTab('models');
  await Promise.all([refresh(), refreshLimits()]);
  setInterval(refresh, 6000);
  setInterval(refreshLimits, 30000);
  setInterval(() => {
    if (!state.online || DEMO) return;
    get('/api/live').then(renderLive).catch(() => {});
  }, 2000);
})();
