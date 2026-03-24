/**
 * GigBook Server - v0.5
 * Con todas las correcciones de la auditoría CPO:
 * - writeAtomic() con try/catch y validación
 * - getLocalIP() filtra APIPA/Docker/VPN
 * - QR server-side (qrcode npm)
 * - Deep Night theme unificado (#0F172A, #38BDF8)
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const qrcode = require('qrcode');

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
  AUTH_TOKEN = crypto.randomBytes(32).toString('hex').substring(0, 32);
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
  try {
    if (fs.existsSync(file)) { fs.copyFileSync(file, bak); }
    fs.writeFileSync(tmp, json, 'utf8');
    const stat = fs.statSync(tmp);
    if (stat.size !== Buffer.byteLength(json, 'utf8')) throw new Error('writeAtomic: size mismatch');
    fs.renameSync(tmp, file);
    if (!fs.existsSync(file)) throw new Error('writeAtomic: file missing after rename');
  } catch (err) {
    if (fs.existsSync(bak)) { try { fs.copyFileSync(bak, file); } catch {} }
    throw err;
  }
}

// ─── DETECTAR IP WI-FI ───────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let wifiIP = null;
  let ethIP = null;
  const BLOCKED = [/^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^10\.(0|255)\./];
  const BLOCK_IFACE = /vmware|virtualbox|docker|hyper|container|veth|loopback|pseudo|teredo/i;
  const PREFER_WIFI = /wlan|wi[-_]?fi|wifi|wireless/i;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (BLOCK_IFACE.test(name)) continue;
    const isWifi = PREFER_WIFI.test(name);
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const ip = addr.address;
        if (BLOCKED.some(r => r.test(ip))) continue;
        if (isWifi && !wifiIP) wifiIP = ip;
        else if (!ethIP) ethIP = ip;
      }
    }
  }
  return wifiIP || ethIP || '127.0.0.1';
}

// ─── APP EXPRESS ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── API ──────────────────────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', version: '0.4', ip: getLocalIP(), port: PORT });
});

app.get('/api/sync', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'no_auth' });
  
  res.json({
    songs: readJSON(FILES.songs) || [],
    setlists: readJSON(FILES.setlists) || [],
    settings: readJSON(FILES.settings) || {},
  });
});

app.post('/api/sync', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'no_auth' });
  try {
    const { songs, setlists, settings } = req.body;
    if (songs) writeAtomic(FILES.songs, songs);
    if (setlists) writeAtomic(FILES.setlists, setlists);
    if (settings) writeAtomic(FILES.settings, settings);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ writeAtomic error:', err.message);
    res.status(500).json({ error: 'write_error', message: 'Error al guardar' });
  }
});

// ── Setup ──────────────────────────────────────────────────────────────────
app.get('/setup', async (req, res) => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;
  let qrDataUrl = '';
  try {
    qrDataUrl = await qrcode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#0F172A', light: '#ffffff' } });
  } catch {}

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GigBook Setup</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --dn-bg:#0F172A; --dn-surface:#111827; --dn-surface2:#1E293B;
      --dn-border:rgba(255,255,255,0.08); --dn-accent:#38BDF8;
      --dn-accent-dim:rgba(56,189,248,0.15); --dn-text:#F8FAFC;
      --dn-text-mid:#94A3B8; --dn-text-dim:#64748B; --dn-success:#4ADE80;
      --dn-font-ui:'Syne',system-ui,sans-serif; --dn-font-mono:'Space Mono','Courier New',monospace;
      --r-sm:6px; --r-md:10px; --r-lg:14px;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--dn-bg);color:var(--dn-text);font-family:var(--dn-font-ui);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:var(--dn-surface);border:1px solid var(--dn-border);border-radius:var(--r-lg);padding:36px;max-width:440px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4)}
    h1{font-family:var(--dn-font-mono);font-size:24px;font-weight:700;color:var(--dn-accent);letter-spacing:-0.02em;margin-bottom:4px}
    .sub{font-size:12px;color:var(--dn-text-dim);margin-bottom:28px}
    .qr-wrap{background:#fff;border-radius:var(--r-md);padding:16px;display:inline-block;margin-bottom:24px}
    .url-box{background:var(--dn-surface2);border:1px solid var(--dn-border);border-radius:var(--r-sm);padding:10px 14px;font-family:var(--dn-font-mono);font-size:13px;color:var(--dn-accent);margin-bottom:16px;word-break:break-all;cursor:pointer;transition:border-color .2s}
    .url-box:hover{border-color:var(--dn-accent)}
    .token-box{background:var(--dn-surface2);border:1px solid var(--dn-accent);border-radius:var(--r-sm);padding:12px 14px;margin-bottom:20px;text-align:left}
    .token-label{font-size:10px;color:var(--dn-text-dim);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
    .token-value{font-size:12px;color:var(--dn-accent);word-break:break-all;font-family:var(--dn-font-mono);margin-bottom:8px}
    .copy-btn{background:var(--dn-accent);color:var(--dn-bg);border:none;padding:7px 14px;border-radius:var(--r-sm);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--dn-font-ui);transition:opacity .15s}
    .copy-btn:hover{opacity:.85}
    .steps{text-align:left;border-top:1px solid var(--dn-border);padding-top:20px}
    .step{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start}
    .step-num{background:var(--dn-accent);color:var(--dn-bg);width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}
    .step-text{font-size:13px;color:var(--dn-text-mid);line-height:1.5}
    .step-text strong{color:var(--dn-text)}
    .ping{font-size:11px;color:var(--dn-text-dim);margin-top:20px;font-family:var(--dn-font-mono)}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dn-success);margin-right:4px;vertical-align:middle}
  </style>
</head>
<body>
  <div class="card">
    <h1>GIGBOOK</h1>
    <p class="sub">Conecta tu teléfono al servidor local</p>
    <div class="qr-wrap">
      ${qrDataUrl ? `<img src="${qrDataUrl}" width="240" height="240" alt="QR">` : '<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#666;font-size:13px">QR no disponible</div>'}
    </div>
    <div class="url-box" onclick="copyUrl()" title="Clic para copiar">${url}</div>
    <div class="token-box">
      <div class="token-label">Token de sincronización</div>
      <div class="token-value" id="token">${AUTH_TOKEN}</div>
      <button class="copy-btn" onclick="copyToken()">📋 Copiar</button>
    </div>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text">Asegúrate de que tu teléfono esté en el <strong>mismo Wi-Fi</strong> que esta computadora.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text">Escanea el QR con la cámara de tu teléfono o abre <strong>${url}</strong> en el navegador.</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text">En la app, ve a <strong>Ajustes → Sincronizar</strong>, pega el token y presiona Sync.</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-text">Si la IP cambia, vuelve a escanear este QR.</div></div>
    </div>
    <p class="ping"><span class="dot"></span>Servidor activo · ${new Date().toLocaleTimeString('es-MX')}</p>
  </div>
  <script>
    function copyToken(){navigator.clipboard.writeText(document.getElementById('token').textContent).then(()=>{const b=document.querySelector('.copy-btn');b.textContent='✓';setTimeout(()=>b.textContent='📋 Copiar',1500)})}
    function copyUrl(){navigator.clipboard.writeText('${url}').then(()=>{const e=document.querySelector('.url-box');e.style.borderColor='#4ADE80';setTimeout(()=>e.style.borderColor='',1000)})}
  </script>
</body>
</html>`);
});

// ── PWA ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const ip = getLocalIP();
  const html = fs.readFileSync(__filename, 'utf8').split('/* PWA_START */')[1].split('/* PWA_END */')[0];
  res.send(html.replace(/{{IP}}/g, ip).replace(/{{PORT}}/g, PORT).replace(/{{TOKEN}}/g, AUTH_TOKEN));
});

/* PWA_START */
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>GigBook</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0a; --surface: #111; --surface2: #1a1a1a; --border: #2a2a2a;
      --accent: #e8ff3a; --accent2: #ff5533; --text: #f0f0f0; --text-dim: #666;
      --font-ui: 'Syne', system-ui, sans-serif; --font-mono: 'Space Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: var(--font-ui); height: 100vh; overflow: hidden; }
    
    .app { display: flex; flex-direction: column; height: 100%; width: 100%; max-width: 1000px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
    
    .nav { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .nav-logo { font-family: var(--font-mono); font-weight: 700; color: var(--accent); }
    .nav-btn { background: none; border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    
    .screen { flex: 1; overflow-y: auto; padding: 16px 16px 100px; }
    .section-label { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin: 20px 0 10px; }
    
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; cursor: pointer; }
    .card:hover { border-color: var(--accent); }
    .card-title { font-weight: 700; font-size: 16px; }
    .card-meta { font-size: 12px; color: var(--text-dim); margin-top: 4px; font-family: var(--font-mono); }
    
    .song-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
    .song-info { flex: 1; cursor: pointer; }
    .song-name { font-weight: 600; }
    .song-sub { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }
    .bpm-chip { background: var(--surface2); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-family: var(--font-mono); }
    
    .tabs { position: fixed; bottom: 0; left: 0; right: 0; display: flex; background: var(--bg); border-top: 1px solid var(--border); max-width: 1000px; margin: 0 auto; }
    .tab { flex: 1; padding: 12px; text-align: center; color: var(--text-dim); cursor: pointer; font-size: 10px; text-transform: uppercase; font-weight: 700; }
    .tab.active { color: var(--accent); }
    .tab-icon { font-size: 18px; display: block; margin-bottom: 4px; }
    
    .fab { position: fixed; bottom: 80px; right: 24px; background: var(--accent); color: #000; width: 56px; height: 56px; border-radius: 50%; border: none; font-size: 24px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    @media (min-width: 1000px) { .fab { right: calc(50% - 470px); } }

    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
    .modal { background: var(--surface); border: 1px solid var(--border); padding: 24px; border-radius: 12px; width: 100%; max-width: 400px; }
    .input { background: var(--surface2); border: 1px solid var(--border); color: #fff; padding: 12px; border-radius: 6px; width: 100%; margin-bottom: 16px; font-family: var(--font-ui); outline: none; }
    .input:focus { border-color: var(--accent); }
    .textarea { background: var(--surface2); border: 1px solid var(--border); color: #fff; padding: 12px; border-radius: 6px; width: 100%; height: 300px; font-family: var(--font-mono); margin-bottom: 16px; resize: none; }
    .btn { background: var(--accent); color: #000; border: none; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; }
    
    .stage { position: fixed; inset: 0; background: #000; z-index: 200; display: flex; flex-direction: column; }
    .stage-top { padding: 16px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.5); }
    .stage-content { flex: 1; overflow-y: auto; padding: 40px 20px 200px; scroll-behavior: smooth; }
    .stage-line { font-family: var(--font-mono); font-size: 24px; line-height: 1.6; color: #fff; min-height: 1.2em; }
    .chord { color: var(--accent); font-weight: 700; }
    .stage-controls { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.9); padding: 20px; border-top: 1px solid #222; }
    .stage-btn { background: #222; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; }
    .stage-btn.active { background: var(--accent); color: #000; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    const CONFIG = { ip: '{{IP}}', port: '{{PORT}}', token: '{{TOKEN}}' };
    let state = {
      tab: 'sets',
      songs: [],
      setlists: [],
      openSetlist: null,
      editingSong: null,
      stage: null,
      playing: false,
      search: '',
      modal: null
    };

    function setState(patch) {
      state = { ...state, ...patch };
      render();
    }

    async function api(path, method = 'GET', body = null) {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.token },
        body: body ? JSON.stringify(body) : null
      });
      return res.json();
    }

    async function load() {
      const data = await api('/api/sync');
      setState({ songs: data.songs, setlists: data.setlists });
    }

    async function sync() {
      await api('/api/sync', 'POST', { songs: state.songs, setlists: state.setlists });
    }

    let scrollInterval = null;
    function togglePlay() {
      const playing = !state.playing;
      setState({ playing });
      if (playing) {
        scrollInterval = setInterval(() => {
          const el = document.querySelector('.stage-content');
          if (el) el.scrollTop += 1;
        }, 50);
      } else {
        clearInterval(scrollInterval);
      }
    }

    function render() {
      const root = document.getElementById('root');
      if (state.stage) { root.innerHTML = renderStage(); return; }

      let html = '<div class="app">';
      html += '<div class="nav"><span class="nav-logo">GIGBOOK</span><span class="nav-btn" onclick="sync()">SYNC</span></div>';
      html += '<div class="screen">';

      if (state.tab === 'sets') {
        if (state.openSetlist) {
          const sl = state.setlists.find(s => s.id === state.openSetlist);
          html += '<button class="nav-btn" onclick="setState({openSetlist:null})">VOLVER</button>';
          html += '<p class="section-label">' + sl.name + '</p>';
          sl.songs.forEach((id, i) => {
            const s = state.songs.find(x => x.id === id);
            if (s) html += '<div class="song-row"><span class="song-num">' + (i+1) + '</span><div class="song-info" onclick="setState({stage:{slId:sl.id, idx:i}})">' + s.name + '</div><button class="nav-btn" onclick="removeFromSetlist(\\'' + id + '\\')">X</button></div>';
          });
          html += '<p class="section-label">AÑADIR CANCION</p>';
          state.songs.filter(s => !sl.songs.includes(s.id)).forEach(s => {
            html += '<div class="song-row" onclick="addToSetlist(\\'' + s.id + '\\')">' + s.name + '</div>';
          });
        } else {
          html += '<p class="section-label">SETLISTS</p>';
          state.setlists.forEach(sl => {
            html += '<div class="card" onclick="setState({openSetlist:\\'' + sl.id + '\\'})"><div class="card-title">' + sl.name + '</div><div class="card-meta">' + sl.songs.length + ' canciones</div></div>';
          });
        }
      } else if (state.tab === 'songs') {
        if (state.editingSong) {
          const s = state.songs.find(x => x.id === state.editingSong) || { name: '', bpm: 120, content: '' };
          html += '<p class="section-label">EDITAR CANCION</p>';
          html += '<input id="edName" class="input" value="' + s.name + '" placeholder="Nombre">';
          html += '<input id="edBpm" class="input" type="number" value="' + s.bpm + '" placeholder="BPM">';
          html += '<textarea id="edContent" class="textarea" placeholder="Contenido">' + (s.content||'') + '</textarea>';
          html += '<button class="btn" onclick="saveSong()">GUARDAR</button>';
          html += '<button class="nav-btn" style="margin-top:10px" onclick="setState({editingSong:null})">CANCELAR</button>';
        } else {
          html += '<p class="section-label">CANCIONES</p>';
          state.songs.forEach(s => {
            html += '<div class="song-row"><div class="song-info" onclick="setState({editingSong:\\'' + s.id + '\\'})">' + s.name + '</div><span class="bpm-chip">' + s.bpm + '</span></div>';
          });
        }
      }

      html += '</div>'; // screen
      html += '<div class="tabs">';
      html += '<div class="tab ' + (state.tab==='sets'?'active':'') + '" onclick="setState({tab:\\'sets\\', openSetlist:null})">Sets</div>';
      html += '<div class="tab ' + (state.tab==='songs'?'active':'') + '" onclick="setState({tab:\\'songs\\', editingSong:null})">Songs</div>';
      html += '</div>';
      if (!state.editingSong && !state.openSetlist) {
        html += '<button class="fab" onclick="onFab()">+</button>';
      }
      html += '</div>'; // app

      if (state.modal) {
        html += '<div class="modal-overlay"><div class="modal"><h3>Nuevo Setlist</h3><input id="mName" class="input" placeholder="Nombre"><button class="btn" onclick="createSetlist()">CREAR</button><button class="nav-btn" style="margin-top:10px" onclick="setState({modal:null})">CERRAR</button></div></div>';
      }

      root.innerHTML = html;
    }

    function renderStage() {
      const sl = state.setlists.find(s => s.id === state.stage.slId);
      const song = state.songs.find(s => s.id === sl.songs[state.stage.idx]);
      const lines = (song.content || '').split(\'\\n\');
      let html = '<div class="stage"><div class="stage-top"><button class="stage-btn" onclick="setState({stage:null, playing:false});clearInterval(scrollInterval)">SALIR</button><span>' + (state.stage.idx+1) + ' / ' + sl.songs.length + '</span></div>';
      html += '<div class="stage-content"><h1 style="color:var(--accent);margin-bottom:30px">' + song.name + '</h1>';
      lines.forEach(l => {
        const isChord = l.trim() && !l.replace(/\\b[A-G][#b]?(?:m|maj|min|dim|7|9)?\\b/g, '').trim();
        html += '<div class="stage-line ' + (isChord?\'chord\':\'\') + '">' + l.replace(/\\[(.+?)\\]/g, \'<span class="chord">$1</span>\') + '</div>';
      });
      html += '</div>';
      html += '<div class="stage-controls"><button class="stage-btn ' + (state.playing?\'active\':\'\') + '" onclick="togglePlay()">' + (state.playing?\'PAUSE\':\'PLAY\') + '</button></div></div>';
      return html;
    }

    window.onFab = () => { if (state.tab === 'sets') setState({ modal: 'setlist' }); else setState({ editingSong: 'new' }); };
    window.createSetlist = () => { const name = document.getElementById('mName').value; if (!name) return; const sl = { id: 'sl_' + Date.now(), name, songs: [] }; setState({ setlists: [...state.setlists, sl], modal: null }); sync(); };
    window.saveSong = () => {
      const id = state.editingSong === 'new' ? 's_' + Date.now() : state.editingSong;
      const name = document.getElementById('edName').value;
      const bpm = parseInt(document.getElementById('edBpm').value) || 120;
      const content = document.getElementById('edContent').value;
      const song = { id, name, bpm, content, updatedAt: Date.now() };
      const songs = state.editingSong === 'new' ? [...state.songs, song] : state.songs.map(s => s.id === id ? song : s);
      setState({ songs, editingSong: null });
      sync();
    };
    window.addToSetlist = (id) => { const setlists = state.setlists.map(sl => sl.id === state.openSetlist ? { ...sl, songs: [...sl.songs, id] } : sl); setState({ setlists }); sync(); };
    window.removeFromSetlist = (id) => { const setlists = state.setlists.map(sl => sl.id === state.openSetlist ? { ...sl, songs: sl.songs.filter(x => x !== id) } : sl); setState({ setlists }); sync(); };

    load();
    render();
  </script>
</body>
</html>
/* PWA_END */

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
bootstrap();

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;

  console.log(\'\\n\');
  console.log(\'  GigBook Server v0.4\');
  console.log(\'  ------------------------------------\');
  console.log(\'  Local:    http://localhost:\' + PORT);
  console.log(\'  Red:      \' + url);
  console.log(\'  IP WiFi:  \' + ip);
  console.log(\'  ------------------------------------\');
  console.log(\'  QR Generado en consola y en /setup\');
  console.log(\'\');

  qrcode.generate(url, { small: true });

  console.log(\'\\n  Ctrl+C para detener\\n\');
});
