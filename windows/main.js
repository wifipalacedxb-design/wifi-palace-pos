'use strict';
// WiFi Palace POS for Windows: a secure window around the hosted POS (pos.wifipalace.in) that adds what
// a browser cannot do well on a shop counter: direct receipt printing (LAN ESC/POS or a Windows/USB
// printer without the print dialog), cash-drawer pulse, full-screen counter mode, start with Windows,
// and offline data kept in the app's own folder instead of the browser profile.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const escpos = require('./escpos');

const POS_URL = (process.argv.find(a => a.startsWith('--pos-url=')) || '').slice(10) || process.env.WIFIPOS_URL || 'https://pos.wifipalace.in/';
const ORIGIN = new URL(POS_URL).origin;
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = { fullscreen: false, startWithWindows: false, windowsPrinter: '', openDrawer: false };
let config = { ...defaults }, win = null;

function loadConfig() { try { config = { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')) }; } catch { config = { ...defaults }; } }
function saveConfig() { fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true }); fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2)); }
const trusted = url => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
// Bridge calls are only honoured from the trusted POS page, never from another site or the offline page.
const fromPos = event => trusted(event.senderFrame?.url || event.sender.getURL());

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#f7f6fa', title: 'WiFi Palace POS',
    icon: path.join(__dirname, 'build', 'icon.png'), fullscreen: !!config.fullscreen,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false, partition: 'persist:wifipalace-pos', spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  // Stay on the POS site; WhatsApp, email, phone and other links open in their normal apps.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!trusted(url) && !url.startsWith('file:')) { e.preventDefault(); if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url); } });
  // First start without internet (nothing cached yet): show a friendly retry page instead of a browser error.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: POS_URL } }); });
  win.loadURL(POS_URL);
  buildMenu();
}

function buildMenu() {
  const toggle = key => () => { config[key] = !config[key]; saveConfig(); if (key === 'fullscreen') win.setFullScreen(config.fullscreen); if (key === 'startWithWindows') app.setLoginItemSettings({ openAtLogin: config.startWithWindows }); buildMenu(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'POS', submenu: [
      { label: 'Reload', accelerator: 'F5', click: () => win.loadURL(POS_URL) },
      { label: 'Full screen (counter mode)', type: 'checkbox', checked: !!config.fullscreen, accelerator: 'F11', click: toggle('fullscreen') },
      { label: 'Start with Windows', type: 'checkbox', checked: !!config.startWithWindows, click: toggle('startWithWindows') },
      { type: 'separator' },
      { label: 'Open cash drawer after each receipt', type: 'checkbox', checked: !!config.openDrawer, click: toggle('openDrawer') },
      { type: 'separator' }, { role: 'quit', label: 'Exit' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { label: 'Help', submenu: [{ label: 'About WiFi Palace POS', click: () => dialog.showMessageBox(win, { type: 'info', title: 'WiFi Palace POS', message: 'WiFi Palace POS for Windows ' + app.getVersion(), detail: 'Software by WiFi Palace\nsales@wifipalace.com\n' + ORIGIN }) }] }
  ]));
}

// --- bridge ----------------------------------------------------------------------------------------------
ipcMain.handle('pos:print-network', async (event, job) => {
  if (!fromPos(event)) throw new Error('Not allowed');
  const data = escpos.buildJob({ width: job.width, height: job.height, bits: Buffer.from(job.bits), cut: job.cut !== false, drawer: !!config.openDrawer });
  await escpos.send(job.host, data, { allowLoopback: process.env.WIFIPOS_TEST_LOOPBACK_PRINTER === '1' });
  return true;
});
ipcMain.handle('pos:printers', async event => { if (!fromPos(event)) return []; return (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, isDefault: !!p.isDefault })); });
ipcMain.handle('pos:config', event => (fromPos(event) ? { windowsPrinter: config.windowsPrinter, openDrawer: !!config.openDrawer, version: app.getVersion() } : null));
ipcMain.handle('pos:set-windows-printer', (event, name) => { if (!fromPos(event)) return false; config.windowsPrinter = typeof name === 'string' ? name.slice(0, 200) : ''; saveConfig(); return true; });
// Windows/USB printer: print the receipt page silently to the chosen printer (no dialog). Without one, show the dialog.
ipcMain.handle('pos:print-html', (event, html) => new Promise((resolve, reject) => {
  if (!fromPos(event) || typeof html !== 'string' || html.length > 3000000) { reject(new Error('Not allowed')); return; }
  const printer = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  printer.webContents.once('did-finish-load', () => {
    const silent = !!config.windowsPrinter;
    printer.webContents.print({ silent, deviceName: config.windowsPrinter || undefined, printBackground: true, margins: { marginType: 'none' } }, (ok, reason) => {
      printer.destroy();
      if (ok || reason === 'cancelled') resolve(ok); else reject(new Error('Printing failed: ' + reason));
    });
  });
}));
ipcMain.handle('pos:save-file', async (event, { name, text }) => {
  if (!fromPos(event)) return false;
  const safe = String(name || 'export.txt').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe) });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, String(text ?? ''), 'utf8');
  return true;
});

app.whenReady().then(() => {
  loadConfig();
  // Deny camera, microphone, location and other permissions the POS never needs.
  session.fromPartition('persist:wifipalace-pos').setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
