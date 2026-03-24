const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { spawn } = require('child_process');
const QRCode  = require('qrcode');

let mainWindow = null;
let tray = null;
let serverProcess = null;

const SERVER_PORT = 3000;
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'gigbook-server')
  : path.join(__dirname, '..', 'gigbook-server');

function getLocalIP() {
  const os = require('os');
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

function getServerURL() {
  return `http://localhost:${SERVER_PORT}`;
}

function getServerURLLocal() {
  return `http://${getLocalIP()}:${SERVER_PORT}`;
}

function startServer() {
  if (serverProcess) return;

  const serverPath = path.join(SERVER_DIR, 'server.js');
  serverProcess = spawn('node', [serverPath], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  serverProcess.stdout.on('data', (data) => {
    output += data.toString();
    if (mainWindow) {
      mainWindow.webContents.send('server-output', data.toString());
    }
  });

  serverProcess.stderr.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('server-output', data.toString());
    }
  });

  serverProcess.on('close', (code) => {
    serverProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send('server-status', { running: false, code });
    }
  });

  setTimeout(async () => {
    const urlLocal = getServerURLLocal();
    if (mainWindow) {
      mainWindow.webContents.send('server-status', { running: true });
      mainWindow.webContents.send('server-info', {
        url: getServerURL(),
        urlLocal,
        ip: getLocalIP(),
        port: SERVER_PORT
      });

      // Read auth token from server data dir and embed it in the QR
      let token = null;
      try {
        const tokenFile = path.join(SERVER_DIR, 'data', 'token.json');
        const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        token = tokenData.token || null;
      } catch {}

      if (token) mainWindow.webContents.send('server-token', token);

      try {
        const qrContent = token ? `${urlLocal}?autotoken=${token}` : urlLocal;
        const dataUrl = await QRCode.toDataURL(qrContent, { width: 220, margin: 1 });
        mainWindow.webContents.send('server-qr', dataUrl);
      } catch (e) {
        console.error('QR generation failed:', e);
      }
    }
    shell.openExternal(urlLocal);
  }, 500); // Reduced delay; QR arrives async anyway

  // Also ping the server to confirm it's up before showing "running"
  const pingServer = () => {
    http.get(`http://localhost:${SERVER_PORT}/api/ping`, (res) => {
      if (res.statusCode === 200 && mainWindow) {
        mainWindow.webContents.send('server-status', { running: true });
      }
    }).on('error', () => {
      // Server not ready yet, retry
      setTimeout(pingServer, 800);
    });
  };
  pingServer();
}

function stopServer() {
  if (serverProcess) {
    const pid = serverProcess.pid;
    serverProcess.kill();
    serverProcess = null;
    // On Windows, kill() sends SIGTERM which Node may ignore; force-kill the whole tree
    if (process.platform === 'win32' && pid) {
      try { require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 550,
    resizable: true,
    center: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    title: 'GigBook Server'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    const { nativeImage } = require('electron');
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir GigBook Server',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Abrir en navegador',
      click: () => {
        shell.openExternal(getServerURLLocal());
      }
    },
    { type: 'separator' },
    {
      label: 'Iniciar servidor',
      click: () => startServer()
    },
    {
      label: 'Detener servidor',
      click: () => stopServer()
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        stopServer();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('GigBook Server');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

ipcMain.handle('get-server-url', () => {
  return getServerURLLocal();
});

ipcMain.handle('get-server-info', () => {
  return {
    url: getServerURL(),
    urlLocal: getServerURLLocal(),
    ip: getLocalIP(),
    port: SERVER_PORT
  };
});

ipcMain.handle('start-server', () => {
  startServer();
  return { success: true };
});

ipcMain.handle('stop-server', () => {
  stopServer();
  return { success: true };
});

ipcMain.handle('open-url', (event, url) => {
  shell.openExternal(url);
});
