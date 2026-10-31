'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  shell,
  screen,
  dialog,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_CONSOLE_URL = 'https://opencode.ai/console';
const APP_ID = 'ai.opencode.monitor';
const COLLECTOR_TIMEOUT_MS = 12000;
const MINI_HEIGHT = 168;
const collectorToken = crypto.randomBytes(32).toString('hex');

let win = null;
let tray = null;
let collector = null;
let collectorPort = null;
let quitting = false;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const isDemo = process.argv.includes('--demo');

const defaults = {
  width: 420,
  height: 700,
  x: null,
  y: null,
  opacity: 0.97,
  pinned: true,
  mini: false,
  notifications: true,
};

function labels() {
  const ru = String(app.getLocale() || '').toLowerCase().startsWith('ru');
  return ru
    ? {
        show: 'Показать / скрыть',
        pinned: 'Всегда сверху',
        mini: 'Мини-режим',
        notifications: 'Уведомления о лимитах',
        login: 'Запускать при входе',
        console: 'Открыть Console',
        about: 'О программе',
        quit: 'Выход',
        errorTitle: 'OpenCode Monitor',
      }
    : {
        show: 'Show / hide',
        pinned: 'Always on top',
        mini: 'Mini mode',
        notifications: 'Limit notifications',
        login: 'Start at login',
        console: 'Open Console',
        about: 'About',
        quit: 'Quit',
        errorTitle: 'OpenCode Monitor',
      };
}

function readSettings() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); } catch {}
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}

function unpackedPath(...parts) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
  return path.join(__dirname, ...parts);
}

function startCollector() {
  return new Promise((resolve, reject) => {
    const script = unpackedPath('collector.js');
    if (!fs.existsSync(script)) return reject(new Error('collector.js is missing'));

    collector = spawn(process.execPath, [script], {
      cwd: path.dirname(script),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MONITOR_PORT: process.env.MONITOR_PORT || '0',
        MONITOR_TOKEN: collectorToken,
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(port);
    };

    const timer = setTimeout(() => {
      finish(new Error('Collector did not start within ' + COLLECTOR_TIMEOUT_MS + ' ms' + (stderr ? '\n\n' + stderr.slice(-1500) : '')));
    }, COLLECTOR_TIMEOUT_MS);

    collector.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('MONITOR_READY ')) continue;
        try {
          const info = JSON.parse(line.slice('MONITOR_READY '.length));
          finish(null, info.port);
        } catch {
          finish(new Error('Collector sent an invalid ready message'));
        }
      }
    });

    collector.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });

    collector.on('error', (err) => finish(err));

    collector.on('exit', (code) => {
      collector = null;
      if (!settled) {
        finish(new Error('Collector exited with code ' + code + (stderr ? '\n\n' + stderr.slice(-1500) : '')));
      }
    });
  });
}

function trayIcon() {
  const file = unpackedPath('assets', 'tray.png');
  if (fs.existsSync(file)) return nativeImage.createFromPath(file);
  return nativeImage.createEmpty();
}

function validConsoleUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'https:' && (host === 'opencode.ai' || host.endsWith('.opencode.ai'))) {
      return url.toString();
    }
  } catch {}
  return DEFAULT_CONSOLE_URL;
}

function openConsole(value) {
  return shell.openExternal(validConsoleUrl(value));
}

function createWindow() {
  const settings = readSettings();
  const primary = screen.getPrimaryDisplay().workArea;
  const width = settings.width;
  const height = settings.mini ? MINI_HEIGHT : settings.height;
  const displays = screen.getAllDisplays();

  const onScreen = (px, py) =>
    px !== null &&
    py !== null &&
    displays.some((display) => {
      const area = display.workArea;
      return (
        px + width > area.x + 40 &&
        px < area.x + area.width - 40 &&
        py + height > area.y + 20 &&
        py < area.y + area.height - 40
      );
    });

  const x = onScreen(settings.x, settings.y) ? settings.x : primary.x + primary.width - width - 24;
  const y = onScreen(settings.x, settings.y) ? settings.y : primary.y + 24;

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 320,
    minHeight: settings.mini ? MINI_HEIGHT : 84,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !!settings.pinned,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (settings.pinned) win.setAlwaysOnTop(true, 'floating');
  win.setOpacity(settings.opacity);

  const query = isDemo ? '?demo=1' : '';
  win.loadURL('http://127.0.0.1:' + collectorPort + '/' + query);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:' + collectorPort + '/')) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.on('move', () => {
    if (!win || win.isDestroyed()) return;
    const [px, py] = win.getPosition();
    writeSettings({ x: px, y: py });
  });
  win.on('resize', () => {
    if (!win || win.isDestroyed()) return;
    const [w, h] = win.getSize();
    if (!readSettings().mini) writeSettings({ width: w, height: h });
  });
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else {
    win.show();
    win.focus();
  }
}

function showAbout() {
  const l = labels();
  dialog.showMessageBox({
    type: 'info',
    title: l.about,
    message: 'OpenCode Monitor ' + app.getVersion(),
    detail:
      (app.getLocale().toLowerCase().startsWith('ru')
        ? 'Неофициальный оверлей для OpenCode. Данные читаются локально и никуда не отправляются.'
        : 'Unofficial OpenCode overlay. All data is read locally and never leaves your machine.') +
      '\n\nhttps://github.com/Niki0zz/opencode-monitor',
    buttons: ['OK'],
  });
}

function buildTrayMenu() {
  if (!tray) return;
  const trayLabels = labels();
  const settings = readSettings();
  const template = [
    { label: trayLabels.show, click: toggleWindow },
    { label: trayLabels.pinned, type: 'checkbox', checked: !!settings.pinned, click: (item) => setPinned(item.checked) },
    { label: trayLabels.mini, type: 'checkbox', checked: !!settings.mini, click: (item) => setMini(item.checked) },
    {
      label: trayLabels.notifications,
      type: 'checkbox',
      checked: settings.notifications !== false,
      click: (item) => setNotifications(item.checked),
    },
  ];

  if (app.isPackaged && process.platform !== 'linux') {
    template.push({
      label: trayLabels.login,
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: !!item.checked }),
    });
  }

  template.push(
    { type: 'separator' },
    { label: trayLabels.console, click: () => openConsole(DEFAULT_CONSOLE_URL) },
    { label: trayLabels.about, click: showAbout },
    { type: 'separator' },
    { label: trayLabels.quit, click: () => { quitting = true; app.quit(); } }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('OpenCode Monitor');
  tray.on('double-click', toggleWindow);
  buildTrayMenu();
}

function setPinned(pinned) {
  writeSettings({ pinned: !!pinned });
  if (win) win.setAlwaysOnTop(!!pinned, 'floating');
  buildTrayMenu();
  return !!pinned;
}

function setNotifications(enabled) {
  writeSettings({ notifications: !!enabled });
  if (win) win.webContents.send('win:notifications', !!enabled);
  buildTrayMenu();
  return !!enabled;
}

function setMini(mini) {
  const settings = writeSettings({ mini: !!mini });
  if (!win) return !!mini;
  const [width] = win.getSize();
  const height = mini ? MINI_HEIGHT : settings.height;
  win.setMinimumSize(320, mini ? MINI_HEIGHT : 84);
  win.setBounds({ x: win.getBounds().x, y: win.getBounds().y, width, height }, false);
  win.setAlwaysOnTop(!!settings.pinned, 'floating');
  win.moveTop();
  win.webContents.send('win:mini', !!mini);
  buildTrayMenu();
  return !!mini;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);

    try {
      collectorPort = await startCollector();
    } catch (error) {
      dialog.showErrorBox(labels().errorTitle, String((error && error.message) || error));
      app.quit();
      return;
    }

    createWindow();
    createTray();

    if (!globalShortcut.register('Alt+Shift+O', toggleWindow)) {
      console.warn('Global shortcut Alt+Shift+O is already in use');
    }

    ipcMain.handle('win:minimize', () => {
      if (win) win.minimize();
    });
    ipcMain.handle('win:close', () => {
      if (win) win.hide();
    });
    ipcMain.handle('win:pin', (_event, value) => setPinned(value));
    ipcMain.handle('win:mini', (_event, value) => setMini(value));
    ipcMain.handle('win:opacity', (_event, value) => {
      const opacity = Math.min(1, Math.max(0.55, Number(value) || 1));
      writeSettings({ opacity });
      if (win) win.setOpacity(opacity);
      return opacity;
    });
    ipcMain.handle('app:console', (_event, value) => openConsole(value));
    ipcMain.handle('app:settings', () => readSettings());
    ipcMain.handle('app:version', () => app.getVersion());
    ipcMain.handle('app:token', () => collectorToken);
    ipcMain.handle('app:notify', (_event, payload) => {
      if (!Notification.isSupported()) return false;
      const title = String((payload && payload.title) || '').slice(0, 120);
      const body = String((payload && payload.body) || '').slice(0, 300);
      if (!title) return false;
      new Notification({ title, body }).show();
      return true;
    });
  }).catch((error) => {
    dialog.showErrorBox(labels().errorTitle, String((error && error.message) || error));
    app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (collector) {
      try { collector.kill(); } catch {}
    }
  });

  app.on('window-all-closed', () => {});
}
