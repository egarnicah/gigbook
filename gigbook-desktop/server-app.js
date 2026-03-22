/**
 * GigBook Server - v0.2
 * Compilado con pkg para crear ejecutable portable
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const qrcode = require('qrcode-terminal');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(path.dirname(process.execPath), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'token.json');
const FILES = {
  songs: path.join(DATA_DIR, 'songs.json'),
  setlists: path.join(DATA_DIR, 'setlists.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
};

// Token
let AUTH_TOKEN = process.env.TOKEN;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!AUTH_TOKEN && fs.existsSync(TOKEN_FILE)) {
  const tokenData = readJSON(TOKEN_FILE);
  AUTH_TOKEN = tokenData?.token;
}
if (!AUTH_TOKEN) {
  AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
  writeAtomic(TOKEN_FILE, { token: AUTH_TOKEN });
}

// ─── BOOTSTRAP ──────────────────────────────────────────────────────────────
function bootstrap() {
  const defaults = {
    songs: [],
    setlists: [],
    settings: { fontSize: 'medium', autoHide: true },
  };
  for (const [key, file] of Object.entries(FILES)) {
    if (!fs.existsSync(file)) {
      writeAtomic(file, defaults[key]);
    }
  }
}

// ─── UTILIDADES ────────────────────────────────────────────────────────────
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const bak = file + '.bak';
    if (fs.existsSync(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf8')); } catch {}
    }
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  const bak = file + '.bak';
  const json = JSON.stringify(data, null, 2);
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, bak);
  }
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, file);
}

// ─── APP EXPRESS ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  const songs = readJSON(FILES.songs) || [];
  const setlists = readJSON(FILES.setlists) || [];
  res.json({
    status: 'ok',
    version: '0.2',
    songCount: songs.length,
    setlistCount: setlists.length,
    serverTime: Date.now(),
    needsAuth: true,
  });
});

app.get('/api/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  res.json({ ok: true });
});

// ── Sync ──────────────────────────────────────────────────────────────────────
function mergeByTimestamp(serverItems, clientItems) {
  const map = new Map();
  for (const item of serverItems) map.set(item.id, item);
  for (const clientItem of clientItems) {
    const serverItem = map.get(clientItem.id);
    if (!serverItem || (clientItem.updatedAt || 0) > (serverItem.updatedAt || 0)) {
      map.set(clientItem.id, clientItem);
    }
  }
  return Array.from(map.values());
}

function validateSong(s) {
  return s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.bpm === 'number';
}

function validateSetlist(sl) {
  return sl && typeof sl.id === 'string' && typeof sl.name === 'string' && Array.isArray(sl.songs);
}

function validateSettings(s) {
  if (!s || typeof s !== 'object') return false;
  return Object.keys(s).every(k => ['fontSize', 'autoHide'].includes(k));
}

app.get('/api/sync', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  const songs = readJSON(FILES.songs) || [];
  const setlists = readJSON(FILES.setlists) || [];
  const settings = readJSON(FILES.settings) || {};
  res.json({ songs, setlists, settings, serverTime: Date.now() });
});

app.post('/api/sync', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  const { songs: clientSongs, setlists: clientSetlists, settings: clientSettings } = req.body;
  const conflicts = [];

  if (Array.isArray(clientSongs)) {
    const validSongs = clientSongs.filter(validateSong);
    const serverSongs = readJSON(FILES.songs) || [];
    const merged = mergeByTimestamp(serverSongs, validSongs);
    for (const cs of validSongs) {
      const ss = serverSongs.find(s => s.id === cs.id);
      if (ss && ss.updatedAt && cs.updatedAt && ss.updatedAt !== cs.updatedAt) {
        conflicts.push({ type: 'song', id: cs.id, name: cs.name, winner: cs.updatedAt > ss.updatedAt ? 'client' : 'server' });
      }
    }
    writeAtomic(FILES.songs, merged);
  }

  if (Array.isArray(clientSetlists)) {
    const validSetlists = clientSetlists.filter(validateSetlist);
    const serverSetlists = readJSON(FILES.setlists) || [];
    const merged = mergeByTimestamp(serverSetlists, validSetlists);
    writeAtomic(FILES.setlists, merged);
  }

  if (clientSettings && validateSettings(clientSettings)) {
    const serverSettings = readJSON(FILES.settings) || {};
    writeAtomic(FILES.settings, { ...serverSettings, ...clientSettings });
  }

  res.json({ ok: true, conflicts, serverTime: Date.now() });
});

// ── Songs CRUD ────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  next();
}

app.get('/api/songs', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.songs) || []);
});

app.post('/api/songs/:id', authMiddleware, (req, res) => {
  const song = { ...req.body, id: req.params.id, updatedAt: Date.now() };
  if (!validateSong(song)) return res.status(400).json({ error: 'invalid' });
  const songs = readJSON(FILES.songs) || [];
  const idx = songs.findIndex(s => s.id === song.id);
  const updated = idx >= 0 ? songs.map(s => s.id === song.id ? song : s) : [...songs, song];
  writeAtomic(FILES.songs, updated);
  res.json({ ok: true, song });
});

app.delete('/api/songs/:id', authMiddleware, (req, res) => {
  const songs = readJSON(FILES.songs) || [];
  writeAtomic(FILES.songs, songs.filter(s => s.id !== req.params.id));
  const setlists = readJSON(FILES.setlists) || [];
  writeAtomic(FILES.setlists, setlists.map(sl => ({
    ...sl,
    songs: sl.songs.filter(id => id !== req.params.id),
  })));
  res.json({ ok: true });
});

// ── Setlists CRUD ─────────────────────────────────────────────────────────────
app.get('/api/setlists', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.setlists) || []);
});

app.post('/api/setlists/:id', authMiddleware, (req, res) => {
  const sl = { ...req.body, id: req.params.id, updatedAt: Date.now() };
  if (!validateSetlist(sl)) return res.status(400).json({ error: 'invalid' });
  const setlists = readJSON(FILES.setlists) || [];
  const idx = setlists.findIndex(s => s.id === sl.id);
  const updated = idx >= 0 ? setlists.map(s => s.id === sl.id ? sl : s) : [...setlists, sl];
  writeAtomic(FILES.setlists, updated);
  res.json({ ok: true, setlist: sl });
});

app.delete('/api/setlists/:id', authMiddleware, (req, res) => {
  const setlists = readJSON(FILES.setlists) || [];
  writeAtomic(FILES.setlists, setlists.filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

app.get('/api/settings', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.settings) || {});
});

app.post('/api/settings', authMiddleware, (req, res) => {
  if (!validateSettings(req.body)) return res.status(400).json({ error: 'invalid' });
  const current = readJSON(FILES.settings) || {};
  writeAtomic(FILES.settings, { ...current, ...req.body });
  res.json({ ok: true });
});

// ── Setup page ───────────────────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/vmware|virtualbox|docker|lo/i.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

app.get('/setup', (req, res) => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GigBook — Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; color: #f0f0f0; font-family: 'Courier New', monospace;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #111; border: 1px solid #2a2a2a; border-radius: 12px;
            padding: 36px; max-width: 480px; width: 100%; text-align: center; }
    h1 { font-size: 22px; color: #e8ff3a; letter-spacing: 0.1em; margin-bottom: 6px; }
    .sub { font-size: 12px; color: #666; margin-bottom: 32px; }
    .qr-wrap { background: #fff; border-radius: 8px; padding: 20px; display: inline-block; margin-bottom: 28px; }
    .url { background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
           padding: 12px 16px; font-size: 15px; color: #e8ff3a; margin-bottom: 16px;
           word-break: break-all; }
    .token-box { background: #1a1a1a; border: 1px solid #e8ff3a; border-radius: 6px;
                 padding: 12px 16px; margin-bottom: 24px; }
    .token-label { font-size: 10px; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.1em; }
    .token-value { font-size: 14px; color: #e8ff3a; word-break: break-all; font-weight: bold; }
    .copy-btn { background: #e8ff3a; color: #000; border: none; padding: 8px 16px; 
                border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; margin-top: 8px; }
    .steps { text-align: left; border-top: 1px solid #2a2a2a; padding-top: 20px; }
    .step { display: flex; gap: 12px; margin-bottom: 14px; align-items: flex-start; }
    .step-num { background: #e8ff3a; color: #000; width: 22px; height: 22px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
    .step-text { font-size: 13px; color: #aaa; line-height: 1.5; }
    .step-text strong { color: #f0f0f0; }
    .ping { font-size: 11px; color: #444; margin-top: 20px; }
    .ping span { color: #4caf50; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎸 GigBook</h1>
    <p class="sub">Conecta tu teléfono al servidor local</p>
    <div class="qr-wrap"><canvas id="qr"></canvas></div>
    <div class="url">${url}</div>
    <div class="token-box">
      <div class="token-label">Token de sincronización</div>
      <div class="token-value" id="token">${AUTH_TOKEN}</div>
      <button class="copy-btn" onclick="copyToken()">📋 Copiar token</button>
    </div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">Asegúrate de que tu teléfono esté en el <strong>mismo Wi-Fi</strong> que esta computadora.</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">Escanea el QR con la cámara de tu teléfono o abre <strong>${url}</strong> en el navegador.</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">En la app, ve a <strong>Ajustes → Sincronizar</strong>, pega el token y presiona Sync.</div>
      </div>
    </div>
    <p class="ping">Servidor activo · <span>●</span> ${new Date().toLocaleTimeString('es-MX')}</p>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    new QRCode(document.getElementById('qr'), { text: '${url}', width: 200, height: 200, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
    function copyToken() {
      navigator.clipboard.writeText(document.getElementById('token').textContent).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '✓ Copiado';
        setTimeout(() => btn.textContent = '📋 Copiar token', 2000);
      });
    }
  </script>
</body>
</html>`);
});

// ── Arranque ─────────────────────────────────────────────────────────────────
bootstrap();

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;

  console.log('\n');
  console.log('  🎸  GigBook Server v0.2');
  console.log('  ─────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Red:      ${url}`);
  console.log(`  Setup:    ${url}/setup`);
  console.log(`  Token:    ${AUTH_TOKEN.substring(0, 16)}...`);
  console.log('  ─────────────────────────────────────');
  console.log('  Escanea el QR en /setup con tu teléfono\n');

  qrcode.generate(url, { small: true });

  console.log('\n  Ctrl+C para detener el servidor\n');
});
