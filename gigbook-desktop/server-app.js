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
  res.json({ status: 'ok', version: '0.5', ip: getLocalIP(), port: PORT });
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

// ── PWA HTML ──────────────────────────────────────────────────────────────────
const PWA_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>GigBook</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:#0F172A; --surface:#1E293B; --surface2:#334155; --border:#334155;
      --accent:#38BDF8; --accent2:#FB923C; --text:#F8FAFC; --text-dim:#64748B; --text-mid:#94A3B8;
      --font-ui:'Syne',system-ui,sans-serif; --font-mono:'Space Mono',monospace;
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:var(--font-ui); height:100vh; overflow:hidden; }
    .app { display:flex; flex-direction:column; height:100%; width:100%; max-width:1000px; margin:0 auto; border-left:1px solid var(--border); border-right:1px solid var(--border); }
    .nav { display:flex; align-items:center; justify-content:space-between; padding:16px; border-bottom:1px solid var(--border); flex-shrink:0; background:var(--bg); }
    .nav-logo { font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--accent); }
    .nav-sub { font-size:10px; color:var(--text-dim); }
    .nav-btn { background:none; border:1px solid var(--border); color:var(--text-mid); padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; font-family:var(--font-ui); transition:all .15s; }
    .nav-btn:hover { border-color:var(--accent); color:var(--accent); }
    .screen { flex:1; overflow-y:auto; padding:0 16px 100px; }
    .section-label { font-size:10px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.12em; margin:20px 0 10px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:14px; margin-bottom:10px; cursor:pointer; transition:all .15s; }
    .card:hover { border-color:var(--accent); }
    .card-title { font-weight:700; font-size:16px; }
    .card-meta { font-size:12px; color:var(--text-dim); margin-top:4px; font-family:var(--font-mono); }
    .song-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }
    .song-num { font-family:var(--font-mono); font-size:11px; color:var(--text-dim); width:20px; flex-shrink:0; text-align:right; }
    .song-info { flex:1; cursor:pointer; }
    .song-name { font-weight:600; font-size:14px; }
    .song-sub { font-size:11px; color:var(--text-dim); font-family:var(--font-mono); }
    .bpm-chip { background:var(--surface2); padding:2px 8px; border-radius:12px; font-size:10px; font-family:var(--font-mono); color:var(--text-mid); }
    .tabs { position:fixed; bottom:0; left:0; right:0; display:flex; background:var(--bg); border-top:1px solid var(--border); max-width:1000px; margin:0 auto; }
    .tab { flex:1; padding:12px; text-align:center; color:var(--text-dim); cursor:pointer; font-size:10px; text-transform:uppercase; font-weight:700; transition:color .15s; }
    .tab.active { color:var(--accent); }
    .tab-icon { font-size:18px; display:block; margin-bottom:4px; }
    .fab { position:fixed; bottom:80px; right:24px; background:var(--accent); color:#020617; width:56px; height:56px; border-radius:50%; border:none; font-size:24px; font-weight:bold; cursor:pointer; box-shadow:0 4px 20px rgba(56,189,248,.25); transition:transform .15s; }
    .fab:hover { transform:scale(1.07); }
    @media(min-width:1000px){.fab{right:calc(50% - 470px)}}
    .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.8); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px; }
    .modal { background:var(--surface); border:1px solid var(--border); padding:24px; border-radius:12px; width:100%; max-width:400px; }
    .modal h3 { font-size:16px; margin-bottom:16px; }
    .input { background:var(--surface2); border:1px solid var(--border); color:#fff; padding:12px; border-radius:6px; width:100%; margin-bottom:14px; font-family:var(--font-ui); font-size:14px; outline:none; transition:border-color .15s; }
    .input:focus { border-color:var(--accent); }
    .textarea { background:var(--surface2); border:1px solid var(--border); color:#fff; padding:12px; border-radius:6px; width:100%; height:280px; font-family:var(--font-mono); font-size:13px; margin-bottom:14px; resize:none; outline:none; transition:border-color .15s; }
    .textarea:focus { border-color:var(--accent); }
    .btn { background:var(--accent); color:#020617; border:none; padding:12px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%; font-size:14px; font-family:var(--font-ui); }
    .btn-ghost { background:none; border:1px solid var(--border); color:var(--text-mid); padding:10px; border-radius:6px; font-weight:600; cursor:pointer; width:100%; font-size:13px; font-family:var(--font-ui); margin-top:8px; }
    .stage { position:fixed; inset:0; background:#000; z-index:200; display:flex; flex-direction:column; }
    .stage-top { padding:16px; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,.5); }
    .stage-content { flex:1; overflow-y:auto; padding:40px 20px 200px; scroll-behavior:smooth; }
    .stage-line { font-family:var(--font-mono); font-size:24px; line-height:1.6; color:#fff; min-height:1.2em; }
    .chord { color:var(--accent); font-weight:700; }
    .stage-controls { position:fixed; bottom:0; left:0; right:0; background:rgba(0,0,0,.9); padding:20px; border-top:1px solid #222; display:flex; gap:8px; }
    .stage-btn { background:#222; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px; font-family:var(--font-mono); }
    .stage-btn.active { background:var(--accent); color:#020617; }
    .stage-song-name { font-family:var(--font-mono); font-size:12px; color:rgba(255,255,255,.5); flex:1; text-align:center; }
    .empty { text-align:center; padding:60px 20px; color:var(--text-dim); }
    .empty-icon { font-size:48px; margin-bottom:12px; opacity:.3; }
    .empty-text { font-size:14px; font-weight:600; color:var(--text-mid); margin-bottom:6px; }
    .empty-sub { font-size:12px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    var CONFIG = { ip:'{{IP}}', port:'{{PORT}}', token:'{{TOKEN}}' };
    var state = { tab:'sets', songs:[], setlists:[], openSetlist:null, editingSong:null, stage:null, playing:false, search:'', modal:null };
    function setState(patch) { state = Object.assign({}, state, patch); render(); }
    function api(path, method, body) {
      return fetch(path, { method:method||'GET', headers:{'Content-Type':'application/json','Authorization':'Bearer '+CONFIG.token}, body:body?JSON.stringify(body):null }).then(function(r){return r.json()});
    }
    function load() { api('/api/sync').then(function(d){ setState({songs:d.songs||[],setlists:d.setlists||[]}); }); }
    function sync() { api('/api/sync','POST',{songs:state.songs,setlists:state.setlists}); }
    var scrollInterval = null;
    function togglePlay() {
      state.playing = !state.playing;
      setState({playing:state.playing});
      if(state.playing) {
        scrollInterval = setInterval(function(){ var el = document.querySelector('.stage-content'); if(el) el.scrollTop += 1; }, 50);
      } else {
        clearInterval(scrollInterval);
      }
    }
    function render() {
      var root = document.getElementById('root');
      if(state.stage) { root.innerHTML = renderStage(); return; }
      var html = '<div class="app">';
      html += '<div class="nav"><span class="nav-logo">GIGBOOK</span><span class="nav-sub">v0.5</span><span class="nav-btn" onclick="sync()">SYNC</span></div>';
      html += '<div class="screen">';
      if(state.tab === 'sets') {
        if(state.openSetlist) {
          var sl = state.setlists.find(function(s){return s.id===state.openSetlist});
          html += '<div class="nav"><span class="nav-btn" onclick="setState({openSetlist:null})">&larr; Volver</span><span class="nav-logo" style="font-size:14px">'+sl.name+'</span><span></span></div>';
          if(!sl.songs.length) html += '<div class="empty"><div class="empty-icon">&#63743;</div><div class="empty-text">Sin canciones</div><div class="empty-sub">A&ntilde;ade canciones desde la lista</div></div>';
          sl.songs.forEach(function(id,i){
            var s = state.songs.find(function(x){return x.id===id});
            if(s) html += '<div class="song-row"><span class="song-num">'+(i+1)+'</span><div class="song-info" onclick="setState({stage:{slId:sl.id,idx:'+i+'}})"><div class="song-name">'+s.name+'</div><div class="song-sub">'+s.bpm+' BPM</div></div><button class="nav-btn" onclick="event.stopPropagation();removeFromSetlist(&quot;'+id+'&quot;)">X</button></div>';
          });
          html += '<p class="section-label">A&Ntilde;ADIR CANCIONES</p>';
          state.songs.filter(function(s){return !sl.songs.includes(s.id)}).forEach(function(s){
            html += '<div class="song-row" onclick="addToSetlist(&quot;'+s.id+'&quot;)"><div class="song-info"><div class="song-name">'+s.name+'</div><div class="song-sub">'+s.bpm+' BPM</div></div></div>';
          });
        } else {
          html += '<p class="section-label">SETLISTS</p>';
          if(!state.setlists.length) html += '<div class="empty"><div class="empty-icon">&#128203;</div><div class="empty-text">Sin setlists</div><div class="empty-sub">Toca + para crear tu primera</div></div>';
          state.setlists.forEach(function(sl2){ html += '<div class="card" onclick="setState({openSetlist:&quot;'+sl2.id+'&quot;})"><div class="card-title">'+sl2.name+'</div><div class="card-meta">'+sl2.songs.length+' canciones</div></div>'; });
        }
      } else if(state.tab === 'songs') {
        if(state.editingSong) {
          var s2 = state.songs.find(function(x){return x.id===state.editingSong}) || {name:'',bpm:120,content:''};
          html += '<p class="section-label">'+(state.editingSong==='new'?'NUEVA CANCI&Oacute;N':'EDITAR CANCI&Oacute;N')+'</p>';
          html += '<input id="edName" class="input" value="'+s2.name+'" placeholder="Nombre de la canci&oacute;n">';
          html += '<input id="edBpm" class="input" type="number" value="'+s2.bpm+'" placeholder="BPM" style="max-width:120px">';
          html += '<textarea id="edContent" class="textarea" placeholder="Contenido (usa [Am] para acordes)">'+(s2.content||'')+'</textarea>';
          html += '<button class="btn" onclick="saveSong()">GUARDAR</button>';
          html += '<button class="btn-ghost" onclick="setState({editingSong:null})">CANCELAR</button>';
        } else {
          html += '<p class="section-label">CANCIONES</p>';
          if(!state.songs.length) html += '<div class="empty"><div class="empty-icon">&#127925;</div><div class="empty-text">Sin canciones</div><div class="empty-sub">Toca + para a&ntilde;adir tu primera</div></div>';
          state.songs.forEach(function(s3){ html += '<div class="song-row"><div class="song-info" onclick="setState({editingSong:&quot;'+s3.id+'&quot;})"><div class="song-name">'+s3.name+'</div><div class="song-sub">'+(s3.content||'').split(/\\n/).length+' l&iacute;neas</div></div><span class="bpm-chip">'+s3.bpm+'</span></div>'; });
        }
      }
      html += '</div>';
      html += '<div class="tabs">';
      html += '<div class="tab '+(state.tab==='sets'?'active':'')+'" onclick="setState({tab:&apos;sets&apos;,openSetlist:null})"><span class="tab-icon">&#128203;</span>Sets</div>';
      html += '<div class="tab '+(state.tab==='songs'?'active':'')+'" onclick="setState({tab:&apos;songs&apos;,editingSong:null})"><span class="tab-icon">&#127925;</span>Songs</div>';
      html += '</div>';
      if(!state.editingSong && !state.openSetlist) html += '<button class="fab" onclick="onFab()">+</button>';
      html += '</div>';
      if(state.modal) {
        html += '<div class="modal-overlay" onclick="if(event.target===this)setState({modal:null})"><div class="modal"><h3>Nuevo Setlist</h3><input id="mName" class="input" placeholder="Nombre del setlist"><button class="btn" onclick="createSetlist()">CREAR</button><button class="btn-ghost" onclick="setState({modal:null})">CANCELAR</button></div></div>';
      }
      root.innerHTML = html;
    }
    function renderStage() {
      var sl = state.setlists.find(function(s){return s.id===state.stage.slId});
      if(!sl) return '<div class="stage"><div class="stage-top"><button class="stage-btn" onclick="setState({stage:null})">SALIR</button></div></div>';
      var song = state.songs.find(function(s){return s.id===sl.songs[state.stage.idx]});
      if(!song) return '<div class="stage"><div class="stage-top"><button class="stage-btn" onclick="setState({stage:null})">SALIR</button></div></div>';
      var lines = (song.content||'').split('\\n');
      var html = '<div class="stage"><div class="stage-top"><button class="stage-btn" onclick="setState({stage:null,playing:false});clearInterval(scrollInterval)">SALIR</button><span class="stage-song-name">'+song.name+'</span><span style="font-family:var(--font-mono);font-size:12px;color:rgba(255,255,255,.4)">'+(state.stage.idx+1)+' / '+sl.songs.length+'</span></div>';
      html += '<div class="stage-content"><h1 style="color:var(--accent);margin-bottom:30px;font-family:var(--font-mono);font-size:28px">'+song.name+'</h1>';
      lines.forEach(function(l){
        var isChord = /\\[(.+?)\\]/.test(l);
        html += '<div class="stage-line">' + l.replace(/\\[(.+?)\\]/g, '<span class="chord">$1</span>') + '</div>';
      });
      html += '</div><div class="stage-controls"><button class="stage-btn" onclick="prevSong()">&lt;</button><button class="stage-btn '+(state.playing?'active':'')+'" onclick="togglePlay()">'+(state.playing?'PAUSE':'PLAY')+'</button><button class="stage-btn" onclick="nextSong()">&gt;</button></div></div>';
      return html;
    }
    function prevSong() {
      var sl = state.setlists.find(function(s){return s.id===state.stage.slId});
      if(state.stage.idx > 0) setState({stage:{slId:sl.id,idx:state.stage.idx-1}});
    }
    function nextSong() {
      var sl = state.setlists.find(function(s){return s.id===state.stage.slId});
      if(state.stage.idx < sl.songs.length-1) setState({stage:{slId:sl.id,idx:state.stage.idx+1}});
    }
    window.onFab = function() { if(state.tab==='sets') setState({modal:'setlist'}); else setState({editingSong:'new'}); };
    window.createSetlist = function() { var name = document.getElementById('mName').value; if(!name) return; var sl = {id:'sl_'+Date.now(),name:name,songs:[]}; setState({setlists:state.setlists.concat([sl]),modal:null}); sync(); };
    window.saveSong = function() {
      var id = state.editingSong==='new' ? 's_'+Date.now() : state.editingSong;
      var name = document.getElementById('edName').value;
      var bpm = parseInt(document.getElementById('edBpm').value) || 120;
      var content = document.getElementById('edContent').value;
      var song = {id:id,name:name,bpm:bpm,content:content,updatedAt:Date.now()};
      var songs = state.editingSong==='new' ? state.songs.concat([song]) : state.songs.map(function(s){return s.id===id?song:s});
      setState({songs:songs,editingSong:null});
      sync();
    };
    window.addToSetlist = function(id) { var setlists = state.setlists.map(function(sl){return sl.id===state.openSetlist?Object.assign({},sl,{songs:sl.songs.concat([id])}):sl}); setState({setlists:setlists}); sync(); };
    window.removeFromSetlist = function(id) { var setlists = state.setlists.map(function(sl){return sl.id===state.openSetlist?Object.assign({},sl,{songs:sl.songs.filter(function(x){return x!==id})}):sl}); setState({setlists:setlists}); sync(); };
    load();
    render();
  </script>
</body>
</html>`;

// ── PWA Routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const ip = getLocalIP();
  res.send(PWA_HTML.replace(/\{\{IP\}\}/g, ip).replace(/\{\{PORT\}\}/g, PORT).replace(/\{\{TOKEN\}\}/g, AUTH_TOKEN));
});

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
bootstrap();

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const url = 'http://' + ip + ':' + PORT;

  console.log('\n');
  console.log('  GigBook Server v0.5');
  console.log('  ------------------------------------');
  console.log('  Local:    http://localhost:' + PORT);
  console.log('  Red:      ' + url);
  console.log('  IP WiFi:  ' + ip);
  console.log('  ------------------------------------');
  console.log('  QR disponible en /setup');
  console.log('\n  Ctrl+C para detener\n');
});
