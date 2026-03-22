/**
 * GigBook Server — v0.2
 * Servidor local Wi-Fi para sincronizar la PWA entre teléfono y computadora.
 *
 * Seguridad:
 * - CORS restrictivo (solo IPs de la red local)
 * - Token de autenticación simple
 * - Rate limiting por IP
 * - Validación de datos en sync
 *
 * Uso:
 *   node server.js
 *   PORT=4000 node server.js
 *   TOKEN=mi-secreto node server.js
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const qrcode  = require('qrcode-terminal');

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const PORT      = process.env.PORT || 3000;
const DATA_DIR  = path.join(__dirname, 'data');
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
    console.log('📁  Carpeta data/ creada');
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

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, bak);
  }
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, file);
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

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/vmware|virtualbox|docker|lo/i.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        ips.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
      }
    }
  }
  return ips;
}

const allowedOrigins = getLocalIPs();

const corsOptions = {
  origin: function(origin, callback) {
    // Requests sin origin (mobile apps, Postman) verificar por IP
    if (!origin) {
      return callback(null, true);
    }
    
    // Verificar si el origin es de la red local
    const isLocal = allowedOrigins.some(prefix => {
      const [p0, p1, p2] = prefix.split('.');
      return origin.startsWith(`http://${p0}.${p1}.${p2}.`) ||
             origin.startsWith(`https://${p0}.${p1}.${p2}.`);
    });

    if (isLocal) {
      callback(null, true);
    } else {
      callback(new Error('Origen no permitido'));
    }
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
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/vmware|virtualbox|docker|lo/i.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({ name, address: addr.address });
      }
    }
  }

  if (candidates.length === 0) return 'localhost';

  const preferred = candidates.find(c => /^(en|eth|wlan)/i.test(c.name));
  return (preferred || candidates[0]).address;
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
    version     : '0.2',
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
  const songs   = readJSON(FILES.songs) || [];
  const updated = songs.filter(s => s.id !== req.params.id);
  writeAtomic(FILES.songs, updated);
  const setlists = readJSON(FILES.setlists) || [];
  const updatedSl = setlists.map(sl => ({
    ...sl,
    songs: sl.songs.filter(id => id !== req.params.id),
  }));
  writeAtomic(FILES.setlists, updatedSl);
  res.json({ ok: true });
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

// ── /setup — página con QR e instrucciones ────────────────────────────────────
app.get('/setup', (req, res) => {
  const ip  = getLocalIP();
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
    canvas, img { display: block; }
    .url { background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
           padding: 12px 16px; font-size: 15px; color: #e8ff3a; margin-bottom: 16px;
           word-break: break-all; }
    .token-box { background: #1a1a1a; border: 1px solid #e8ff3a; border-radius: 6px;
                 padding: 12px 16px; margin-bottom: 24px; }
    .token-label { font-size: 10px; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.1em; }
    .token-value { font-size: 14px; color: #e8ff3a; word-break: break-all; font-weight: bold; }
    .copy-btn { background: #e8ff3a; color: #000; border: none; padding: 8px 16px; 
                border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; 
                margin-top: 8px; }
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

    <div class="qr-wrap">
      <canvas id="qr"></canvas>
    </div>

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
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text">Si la IP cambia, vuelve a escanear este QR. Para evitarlo, fija la IP de tu Mac en <strong>Preferencias de Red</strong>.</div>
      </div>
    </div>

    <p class="ping">Servidor activo · <span>●</span> ${new Date().toLocaleTimeString('es-MX')}</p>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    new QRCode(document.getElementById('qr'), {
      text: '${url}',
      width: 200,
      height: 200,
      colorDark: '#000',
      colorLight: '#fff',
      correctLevel: QRCode.CorrectLevel.M
    });
    
    function copyToken() {
      const token = document.getElementById('token').textContent;
      navigator.clipboard.writeText(token).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '✓ Copiado';
        setTimeout(() => btn.textContent = '📋 Copiar token', 2000);
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
