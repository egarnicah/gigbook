/**
 * GigBook Desktop - Electron wrapper
 * main.js v0.3
 *
 * Notas de portabilidad:
 * - getAppBasePath() detecta si esta empaquetado (pkg) o en desarrollo
 * - icon.png y preload.js se buscan con rutas universales
 * - Deep Night theme (#0F172A)
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');
const { spawn } = require('child_process');
const QRCode    = require('qrcode');

// ─── HELPERS DE RUTA (pkg-aware) ─────────────────────────────────────────────
function getAppBasePath() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

function getResPath(relative) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relative);
  }
  return path.join(__dirname, '..', relative);
}

function getIconPath() {
  const candidates = [
    path.join(getAppBasePath(), 'icon.png'),
    path.join(__dirname, 'icon.png'),
    path.join(getAppBasePath(), 'resources', 'icon.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const SERVER_PORT  = 3000;
const APP_BASE     = getAppBasePath();
const SERVER_DIR   = path.join(APP_BASE);
const SERVER_SCRIPT = path.join(SERVER_DIR, 'server-app.js');

let mainWindow    = null;
let tray          = null;
let serverProcess = null;

// ─── GET LOCAL IP (sin Docker/VPN) ───────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let wifiIP = null;
  let ethIP  = null;

  const BLOCKED = [
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^10\.(0|255)\./,
  ];
  const isBlocked = (ip) => BLOCKED.some(r => r.test(ip));

  const PREFER_WIFI = /wlan|wi[-_]?fi|wifi|wireless/i;
  const BLOCK_IFACE = /vmware|virtualbox|docker|hyper[-_]v|container|veth|loopback|pseudo|teredo|isatap|6to4/i;

  for (const name of Object.keys(interfaces)) {
    if (BLOCK_IFACE.test(name)) continue;
    const isWifi = PREFER_WIFI.test(name);
    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (isBlocked(ip)) continue;
      if (isWifi && !wifiIP) wifiIP = ip;
      else if (!ethIP) ethIP = ip;
    }
  }
  return wifiIP || ethIP || 'localhost';
}

function getServerURL()         { return 'http://localhost:' + SERVER_PORT; }
function getServerURLLocal()   { return 'http://' + getLocalIP() + ':' + SERVER_PORT; }

// ─── SERVER ──────────────────────────────────────────────────────────────────
function startServer() {
  if (serverProcess) return;

  if (!fs.existsSync(SERVER_SCRIPT)) {
    console.error('[GigBook] No se encontro server-app.js en:', SERVER_SCRIPT);
    return;
  }

  serverProcess = spawn('node', [SERVER_SCRIPT], {
    cwd:  SERVER_DIR,
    env:  { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (data) => {
    if (mainWindow) mainWindow.webContents.send('server-output', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    if (mainWindow) mainWindow.webContents.send('server-output', data.toString());
  });

  serverProcess.on('close', (code) => {
    serverProcess = null;
    if (mainWindow) mainWindow.webContents.send('server-status', { running: false, code });
  });

  pingServer();
  notifyServerReady();
}

function pingServer() {
  http.get('http://localhost:' + SERVER_PORT + '/api/ping', (res) => {
    if (res.statusCode === 200 && mainWindow) {
      mainWindow.webContents.send('server-status', { running: true });
    }
  }).on('error', () => {
    setTimeout(pingServer, 800);
  });
}

function notifyServerReady() {
  setTimeout(async () => {
    if (!mainWindow) return;
    const urlLocal = getServerURLLocal();
    mainWindow.webContents.send('server-status', { running: true });
    mainWindow.webContents.send('server-info', {
      url: getServerURL(),
      urlLocal,
      ip:  getLocalIP(),
      port: SERVER_PORT,
    });

    let token = null;
    const tokenFile = path.join(APP_BASE, 'data', 'token.json');
    try {
      if (fs.existsSync(tokenFile)) {
        const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        token = data.token || null;
      }
    } catch {}

    if (token) mainWindow.webContents.send('server-token', token);

    try {
      const qrContent = token ? urlLocal + '?autotoken=' + token : urlLocal;
      const dataUrl = await QRCode.toDataURL(qrContent, { width: 220, margin: 1 });
      mainWindow.webContents.send('server-qr', dataUrl);
    } catch (e) {
      console.error('[QR]', e.message);
    }

    shell.openExternal(urlLocal);
  }, 1500);
}

function stopServer() {
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  serverProcess.kill();
  serverProcess = null;
  if (process.platform === 'win32' && pid) {
    try {
      execSync('taskkill /F /T /PID ' + pid, { stdio: 'ignore' });
    } catch {}
  }
}

// ─── WINDOW ──────────────────────────────────────────────────────────────────
function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width:           900,
    height:          700,
    minWidth:        700,
    minHeight:       550,
    resizable:       true,
    center:          true,
    icon:            getIconPath() || undefined,
    webPreferences: {
      nodeIntegration:    false,
      contextIsolation:    true,
      sandbox:             false,
      preload:             fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
    autoHideMenuBar:  true,
    backgroundColor: '#0F172A',
    title:           'GigBook Server',
  });

  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL(getServerURLLocal());
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── TRAY ────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();
  let trayIcon;

  try {
    if (iconPath && fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
    } else {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir GigBook',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    {
      label: 'Abrir en navegador',
      click: () => { shell.openExternal(getServerURLLocal()); },
    },
    { type: 'separator' },
    {
      label: 'Iniciar servidor',
      click: () => startServer(),
    },
    {
      label: 'Detener servidor',
      click: () => stopServer(),
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        stopServer();
        app.quit();
      },
    },
  ]);

  tray.setToolTip('GigBook Server');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-server-url',    () => getServerURLLocal());
ipcMain.handle('get-server-info',   () => ({
  url: getServerURL(), urlLocal: getServerURLLocal(), ip: getLocalIP(), port: SERVER_PORT,
}));
ipcMain.handle('start-server', () => { startServer(); return { success: true }; });
ipcMain.handle('stop-server',  () => { stopServer();  return { success: true }; });
ipcMain.handle('open-url',     (_, url) => shell.openExternal(url));

// ─── APP LIFECYCLE ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  startServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopServer(); });
