const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;

const SERVER_PORT = 3000;
const SERVER_DIR = path.join(__dirname, '..', 'gigbook-server');

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
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

  setTimeout(() => {
    if (mainWindow) {
      mainWindow.webContents.send('server-status', { running: true });
      mainWindow.webContents.send('server-info', {
        url: getServerURL(),
        urlLocal: getServerURLLocal(),
        ip: getLocalIP(),
        port: SERVER_PORT
      });
    }
  }, 1500);
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 520,
    minWidth: 400,
    minHeight: 450,
    resizable: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
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
