/**
 * GigBook Server — v0.3
 * Servidor local Wi-Fi para sincronizar la PWA.
 *
 * Seguridad:
 * - CORS restrictivo (solo IPs de la red local)
 * - Token de autenticación simple
 * - Rate limiting por IP
 * - Validación de datos en sync
 * - writeAtomic() con try/catch y validación de éxito
 * - QR generado server-side (qrcode npm)
 * - getLocalIP() filtra APIPA/Docker/VPN
 * - Rutas universales (pkg-aware)
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const qrcode  = require('qrcode');
const http    = require('http');

// ─── RUTAS UNIVERSALES (pkg-aware) ─────────────────────────────────────────
function getAppBasePath() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const PORT      = process.env.PORT || 3000;
const APP_BASE  = getAppBasePath();
const DATA_DIR  = path.join(APP_BASE, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'token.json');
const FILES     = {
  songs    : path.join(DATA_DIR, 'songs.json'),
  setlists : path.join(DATA_DIR, 'setlists.json'),
  settings : path.join(DATA_DIR, 'settings.json'),
};

// Token de autenticación (generado o del entorno)
let AUTH_TOKEN = process.env.TOKEN;
if (!AUTH_TOKEN && fs.existsSync(TOKEN_FILE)) {
  const tokenData = readJSON(TOKEN_FILE);
  AUTH_TOKEN = tokenData?.token;
}
if (!AUTH_TOKEN) {
  AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
  writeAtomic(TOKEN_FILE, { token: AUTH_TOKEN });
  console.log('🔑  Nuevo token generado. Compártelo con tus clientes.');
}

// Rate limiting: { ip: { count, resetTime } }
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 100; // requests por ventana

// ─── BOOTSTRAP — asegura que data/ y archivos existen ───────────────────────

function bootstrap() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('📁  Carpeta data/ creada en:', DATA_DIR);
  }
  const defaults = {
    songs    : [],
    setlists : [],
    settings : { fontSize: 'medium', autoHide: true },
  };
  for (const [key, file] of Object.entries(FILES)) {
    if (!fs.existsSync(file)) {
      writeAtomic(file, defaults[key]);
      console.log(`📄  ${path.basename(file)} creado con valores por defecto`);
    }
  }
}

// ─── UTILIDADES DE ARCHIVO ────────────────────────────────────────────────────

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const bak = file + '.bak';
    if (fs.existsSync(bak)) {
      console.warn(`⚠️  ${path.basename(file)} corrupto — restaurando desde .bak`);
      try { return JSON.parse(fs.readFileSync(bak, 'utf8')); } catch {}
    }
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  const bak = file + '.bak';
  const json = JSON.stringify(data, null, 2);

  try {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, bak);
    }
    fs.writeFileSync(tmp, json, 'utf8');

    // Verificar que el tmp fue escrito correctamente antes de renombrar
    const stat = fs.statSync(tmp);
    if (stat.size !== Buffer.byteLength(json, 'utf8')) {
      throw new Error(`writeAtomic: tamaño incorrecto en ${file}`);
    }

    fs.renameSync(tmp, file);

    // Verificar que el archivo final existe y es correcto
    if (!fs.existsSync(file)) {
      throw new Error(`writeAtomic: archivo no existe después de rename: ${file}`);
    }
  } catch (err) {
    // Si hay error, intentar restaurar desde backup
    if (fs.existsSync(bak)) {
      try { fs.copyFileSync(bak, file); } catch {}
    }
    throw err;
  }
}

// ─── RATE LIMITING ─────────────────────────────────────────────────────────

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

// ─── CORS RESTRICTIVO ───────────────────────────────────────────────────────

const VIRTUAL_PATTERN = /hyper[-_v]|vmware|virtualbox|docker|vethernet|loopback|pseudo|teredo|isatap|6to4/i;

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (VIRTUAL_PATTERN.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const ip = addr.address;
        if (ip.startsWith('169.254.') || ip.startsWith('172.')) continue;
        const parts = ip.split('.');
        ips.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
      }
    }
  }
  return ips;
}

const allowedOrigins = getLocalIPs();

const corsOptions = {
  origin: function(origin, callback) {
    // Requests sin origin (mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Permitir localhost para desarrollo
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // Verificar si el origin es de la red local
    const isLocal = allowedOrigins.some(prefix => {
      const [p0, p1, p2] = prefix.split('.');
      return origin.startsWith(`http://${p0}.${p1}.${p2}.`) ||
             origin.startsWith(`https://${p0}.${p1}.${p2}.`);
    });

    callback(null, isLocal);
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Version'],
};

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'no_autorizado', message: 'Token inválido o faltante' });
  }
  
  next();
}

// ─── VALIDACIÓN DE SCHEMA ──────────────────────────────────────────────────

function validateSong(song) {
  if (!song || typeof song !== 'object') return false;
  if (typeof song.id !== 'string' || !song.id) return false;
  if (typeof song.name !== 'string' || !song.name.trim()) return false;
  if (typeof song.bpm !== 'number' || song.bpm < 20 || song.bpm > 300) return false;
  if (song.content && typeof song.content !== 'string') return false;
  return true;
}

function validateSetlist(sl) {
  if (!sl || typeof sl !== 'object') return false;
  if (typeof sl.id !== 'string' || !sl.id) return false;
  if (typeof sl.name !== 'string' || !sl.name.trim()) return false;
  if (!Array.isArray(sl.songs)) return false;
  return true;
}

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  // Solo permitir campos específicos
  const allowed = ['fontSize', 'autoHide'];
  const keys = Object.keys(settings);
  return keys.every(k => allowed.includes(k));
}

// ─── LÓGICA DE MERGE ─────────────────────────────────────────────────────────

function mergeByTimestamp(serverItems, clientItems) {
  const map = new Map();

  for (const item of serverItems) {
    map.set(item.id, item);
  }

  for (const clientItem of clientItems) {
    const serverItem = map.get(clientItem.id);
    if (!serverItem) {
      map.set(clientItem.id, clientItem);
    } else {
      const serverTs = serverItem.updatedAt || 0;
      const clientTs = clientItem.updatedAt || 0;
      if (clientTs > serverTs) {
        map.set(clientItem.id, clientItem);
      }
    }
  }

  return Array.from(map.values());
}

// ─── DETECCIÓN DE IP LOCAL ───────────────────────────────────────────────────

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let wifiIP = null;
  let ethIP  = null;

  const BLOCKED = [
    /^169\.254\./,         // APIPA / link-local
    /^172\.(1[6-9]|2\d|3[01])\./, // Docker bridge (172.16–172.31)
    /^10\.(0|255)\./,      // VPN a veces usa 10.0.x.x
  ];
  const isBlocked = (ip) => BLOCKED.some(r => r.test(ip));

  const PREFER_WIFI  = /wlan|wi[-_]?fi|wifi|wireless/i;
  const BLOCK_IFACE  = /vmware|virtualbox|docker|hyper[-_]v|container|veth|loopback|pseudo|teredo|isatap|6to4/i;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (BLOCK_IFACE.test(name)) continue;

    const isWifi = PREFER_WIFI.test(name);

    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (isBlocked(ip)) continue;

      if (isWifi && !wifiIP) {
        wifiIP = ip;
      } else if (!ethIP) {
        ethIP = ip;
      }
    }
  }

  return wifiIP || ethIP || 'localhost';
}

// ─── APP EXPRESS ──────────────────────────────────────────────────────────────

const app = express();

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas solicitudes' });
  }
  next();
});

const clientDir = path.join(__dirname, 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

// ── Health check (sin auth para verificar conectividad) ───────────────────────
app.get('/api/ping', (req, res) => {
  const songs    = readJSON(FILES.songs)    || [];
  const setlists = readJSON(FILES.setlists) || [];
  res.json({
    status      : 'ok',
    version     : '0.3',
    songCount   : songs.length,
    setlistCount: setlists.length,
    serverTime  : Date.now(),
    needsAuth   : true,
  });
});

// ── Token check (para que el cliente verifique su token) ─────────────────────
app.get('/api/verify', authMiddleware, (req, res) => {
  res.json({ ok: true, token: AUTH_TOKEN.substring(0, 8) + '...' });
});

// ── Sync completo: GET devuelve snapshot, POST hace merge ─────────────────────
app.get('/api/sync', authMiddleware, (req, res) => {
  const songs    = readJSON(FILES.songs)    || [];
  const setlists = readJSON(FILES.setlists) || [];
  const settings = readJSON(FILES.settings) || {};
  res.json({ songs, setlists, settings, serverTime: Date.now() });
});

app.post('/api/sync', authMiddleware, (req, res) => {
  const { songs: clientSongs, setlists: clientSetlists, settings: clientSettings } = req.body;
  const conflicts = [];

  try {
    if (clientSongs !== undefined) {
      if (!Array.isArray(clientSongs)) {
        return res.status(400).json({ error: 'invalid_data', message: 'songs debe ser un array' });
      }
      
      const validSongs = clientSongs.filter(s => {
        if (!validateSong(s)) {
          console.warn(`⚠️  Canción inválida ignorada: ${s.id}`);
          return false;
        }
        return true;
      });

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

    if (clientSetlists !== undefined) {
      if (!Array.isArray(clientSetlists)) {
        return res.status(400).json({ error: 'invalid_data', message: 'setlists debe ser un array' });
      }
      
      const validSetlists = clientSetlists.filter(sl => {
        if (!validateSetlist(sl)) {
          console.warn(`⚠️  Setlist inválido ignorado: ${sl.id}`);
          return false;
        }
        return true;
      });

      const serverSetlists = readJSON(FILES.setlists) || [];
      const merged = mergeByTimestamp(serverSetlists, validSetlists);
      writeAtomic(FILES.setlists, merged);
    }

    if (clientSettings !== undefined) {
      if (!validateSettings(clientSettings)) {
        return res.status(400).json({ error: 'invalid_data', message: 'settings inválidos' });
      }
      const serverSettings = readJSON(FILES.settings) || {};
      const mergedSettings = { ...serverSettings, ...clientSettings };
      writeAtomic(FILES.settings, mergedSettings);
    }

    res.json({
      ok        : true,
      conflicts,
      serverTime: Date.now(),
    });
  } catch (err) {
    console.error('❌ Error en writeAtomic:', err.message);
    res.status(500).json({ error: 'write_error', message: 'Error al guardar datos' });
  }
});

// ── Songs CRUD ────────────────────────────────────────────────────────────────
app.get('/api/songs', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.songs) || []);
});

app.post('/api/songs/:id', authMiddleware, (req, res) => {
  if (!validateSong(req.body)) {
    return res.status(400).json({ error: 'invalid_song', message: 'Datos de canción inválidos' });
  }
  
  const songs   = readJSON(FILES.songs) || [];
  const song    = { ...req.body, id: req.params.id, updatedAt: Date.now() };
  const exists  = songs.findIndex(s => s.id === song.id);
  const updated = exists >= 0
    ? songs.map(s => s.id === song.id ? song : s)
    : [...songs, song];
  writeAtomic(FILES.songs, updated);
  res.json({ ok: true, song });
});

app.delete('/api/songs/:id', authMiddleware, (req, res) => {
  try {
    const songs   = readJSON(FILES.songs) || [];
    const updated = songs.filter(s => s.id !== req.params.id);
    const setlists = readJSON(FILES.setlists) || [];
    const updatedSl = setlists.map(sl => ({
      ...sl,
      songs: sl.songs.filter(id => id !== req.params.id),
    }));
    writeAtomic(FILES.songs, updated);
    writeAtomic(FILES.setlists, updatedSl);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error al eliminar canción:', err.message);
    res.status(500).json({ error: 'write_error', message: 'Error al eliminar' });
  }
});

// ── Setlists CRUD ─────────────────────────────────────────────────────────────
app.get('/api/setlists', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.setlists) || []);
});

app.post('/api/setlists/:id', authMiddleware, (req, res) => {
  if (!validateSetlist(req.body)) {
    return res.status(400).json({ error: 'invalid_setlist', message: 'Datos de setlist inválidos' });
  }
  
  const setlists = readJSON(FILES.setlists) || [];
  const sl       = { ...req.body, id: req.params.id, updatedAt: Date.now() };
  const exists   = setlists.findIndex(s => s.id === sl.id);
  const updated  = exists >= 0
    ? setlists.map(s => s.id === sl.id ? sl : s)
    : [...setlists, sl];
  writeAtomic(FILES.setlists, updated);
  res.json({ ok: true, setlist: sl });
});

app.delete('/api/setlists/:id', authMiddleware, (req, res) => {
  const setlists = readJSON(FILES.setlists) || [];
  writeAtomic(FILES.setlists, setlists.filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', authMiddleware, (req, res) => {
  res.json(readJSON(FILES.settings) || {});
});

app.post('/api/settings', authMiddleware, (req, res) => {
  if (!validateSettings(req.body)) {
    return res.status(400).json({ error: 'invalid_settings', message: 'Ajustes inválidos' });
  }
  const current = readJSON(FILES.settings) || {};
  const updated = { ...current, ...req.body };
  writeAtomic(FILES.settings, updated);
  res.json({ ok: true, settings: updated });
});

// ── /setup — página con QR server-side e instrucciones (Deep Night) ──────────
app.get('/setup', async (req, res) => {
  const ip  = getLocalIP();
  const url = `http://${ip}:${PORT}`;

  let qrDataUrl = '';
  try {
    qrDataUrl = await qrcode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: '#0F172A', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  } catch {
    qrDataUrl = '';
  }

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GigBook — Setup</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Deep Night Tokens ───────────────────────────────────── */
    :root {
      --dn-bg:           #0F172A;
      --dn-surface:      #111827;
      --dn-surface2:     #1E293B;
      --dn-border:       rgba(255,255,255,0.08);
      --dn-accent:       #38BDF8;
      --dn-accent-dim:   rgba(56,189,248,0.15);
      --dn-text:         #F8FAFC;
      --dn-text-mid:     #94A3B8;
      --dn-text-dim:     #64748B;
      --dn-success:      #4ADE80;
      --dn-danger:       #F87171;
      --dn-font-ui:      'Syne', system-ui, sans-serif;
      --dn-font-mono:    'Space Mono', 'Courier New', monospace;
      --r-sm: 6px; --r-md: 10px; --r-lg: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--dn-bg);
      color: var(--dn-text);
      font-family: var(--dn-font-ui);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .card {
      background: var(--dn-surface);
      border: 1px solid var(--dn-border);
      border-radius: var(--r-lg);
      padding: 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    h1 {
      font-family: var(--dn-font-mono);
      font-size: 24px;
      font-weight: 700;
      color: var(--dn-accent);
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }

    .sub {
      font-size: 12px;
      color: var(--dn-text-dim);
      margin-bottom: 28px;
      letter-spacing: 0.04em;
    }

    .qr-wrap {
      background: #ffffff;
      border-radius: var(--r-md);
      padding: 16px;
      display: inline-block;
      margin-bottom: 24px;
    }

    .qr-wrap img, .qr-wrap canvas { display: block; }

    .url-box {
      background: var(--dn-surface2);
      border: 1px solid var(--dn-border);
      border-radius: var(--r-sm);
      padding: 10px 14px;
      font-family: var(--dn-font-mono);
      font-size: 13px;
      color: var(--dn-accent);
      margin-bottom: 16px;
      word-break: break-all;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .url-box:hover { border-color: var(--dn-accent); }

    .token-box {
      background: var(--dn-surface2);
      border: 1px solid var(--dn-accent);
      border-radius: var(--r-sm);
      padding: 12px 14px;
      margin-bottom: 20px;
      text-align: left;
    }
    .token-label {
      font-size: 10px;
      color: var(--dn-text-dim);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 6px;
    }
    .token-value {
      font-size: 12px;
      color: var(--dn-accent);
      word-break: break-all;
      font-family: var(--dn-font-mono);
      margin-bottom: 8px;
    }
    .copy-btn {
      background: var(--dn-accent);
      color: var(--dn-bg);
      border: none;
      padding: 7px 14px;
      border-radius: var(--r-sm);
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      font-family: var(--dn-font-ui);
      transition: opacity 0.15s;
    }
    .copy-btn:hover { opacity: 0.85; }

    .steps {
      text-align: left;
      border-top: 1px solid var(--dn-border);
      padding-top: 20px;
    }
    .step {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
      align-items: flex-start;
    }
    .step-num {
      background: var(--dn-accent);
      color: var(--dn-bg);
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .step-text {
      font-size: 13px;
      color: var(--dn-text-mid);
      line-height: 1.5;
    }
    .step-text strong { color: var(--dn-text); }

    .ping {
      font-size: 11px;
      color: var(--dn-text-dim);
      margin-top: 20px;
      font-family: var(--dn-font-mono);
    }
    .ping span { color: var(--dn-success); }

    .status-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--dn-success);
      margin-right: 4px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>GIGBOOK</h1>
    <p class="sub">Conecta tu teléfono al servidor local</p>

    <div class="qr-wrap">
      ${qrDataUrl
        ? `<img src="${qrDataUrl}" width="240" height="240" alt="QR Code">`
        : `<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#666;font-size:13px;">QR no disponible</div>`
      }
    </div>

    <div class="url-box" onclick="copyUrl()" title="Clic para copiar">${url}</div>

    <div class="token-box">
      <div class="token-label">Token de sincronización</div>
      <div class="token-value" id="token">${AUTH_TOKEN}</div>
      <button class="copy-btn" onclick="copyToken()">📋 Copiar</button>
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
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text">Si la IP cambia, vuelve a escanear este QR. Para evitarlo, fija la IP de tu PC en <strong>Preferencias de Red</strong>.</div>
      </div>
    </div>

    <p class="ping">
      <span class="status-dot"></span>
      Servidor activo · ${new Date().toLocaleTimeString('es-MX')}
    </p>
  </div>

  <script>
    function copyToken() {
      navigator.clipboard.writeText(document.getElementById('token').textContent).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '📋 Copiar', 1500);
      });
    }
    function copyUrl() {
      navigator.clipboard.writeText('${url}').then(() => {
        const el = document.querySelector('.url-box');
        el.style.borderColor = '#4ADE80';
        setTimeout(() => el.style.borderColor = '', 1000);
      });
    }
  </script>
</body>
</html>`);
});

// ── Fallback SPA (cuando haya build de la PWA) ───────────────────────────────
app.get('*', (req, res) => {
  const index = path.join(clientDir, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.redirect('/setup');
  }
});

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────

bootstrap();

app.listen(PORT, '0.0.0.0', () => {
  const ip  = getLocalIP();
  const url = `http://${ip}:${PORT}`;

  console.log('\n');
  console.log('  🎸  GigBook Server v0.3');
  console.log('  ─────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Red:      ${url}`);
  console.log(`  Setup:    ${url}/setup`);
  console.log(`  IP WiFi:  ${ip}`);
  console.log(`  Token:    ${AUTH_TOKEN.substring(0, 16)}...`);
  console.log('  ─────────────────────────────────────');
  console.log('  QR disponible en /setup\n');

  try {
    console.log(qrcode.toString(url, { type: 'terminal', small: true }));
  } catch {}

  console.log('\n  Ctrl+C para detener el servidor\n');
});

// ─── GLOBAL ERROR HANDLERS ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[GigBook] Excepcion no capturada:', err.message);
  console.error('[GigBook] Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[GigBook] Promesa rechazada sin handler:', reason);
});
