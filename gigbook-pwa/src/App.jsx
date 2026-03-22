import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo, lazy, Suspense } from "react";
import "./styles.css";

const TIMEOUT_MS = 5000;

async function apiRequest(baseUrl, path, options = {}) {
  const token = localStorage.getItem('gigbook_token') || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      },
    });
    clearTimeout(timer);
    if (res.status === 401) return { ok: false, error: 'no_autorizado', needsAuth: true };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network_error') };
  }
}

function createApi(baseUrl) {
  const url = baseUrl.replace(/\/$/, '');
  return {
    ping:       ()      => apiRequest(url, '/api/ping'),
    verify:     ()      => apiRequest(url, '/api/verify'),
    syncPull:   ()      => apiRequest(url, '/api/sync'),
    syncPush:   (body)  => apiRequest(url, '/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  };
}

function mergeByTimestamp(local, remote) {
  const map = new Map();
  for (const item of local)  map.set(item.id, item);
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l || (r.updatedAt || 0) >= (l.updatedAt || 0)) map.set(r.id, r);
  }
  return Array.from(map.values());
}

function timeAgo(ts) {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 10)   return 'ahora mismo';
  if (d < 60)   return `hace ${d}s`;
  if (d < 3600) return `hace ${Math.floor(d/60)}min`;
  if (d < 86400)return `hace ${Math.floor(d/3600)}h`;
  return `hace ${Math.floor(d/86400)}d`;
}

const FontLink = lazy(() => import('./components/FontLink.jsx'));

const CHORD_RE = /\b([A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add[0-9]*|maj[37]|m[37]|7|9|11|13)?(?:\/[A-G][#b]?)?)\b/gi;

function isChordLine(line) {
  const stripped = line.trim();
  if (!stripped) return false;
  const cleaned = stripped.replace(CHORD_RE, "").replace(/[\s\|]+/g, "").trim();
  return cleaned.length === 0 && CHORD_RE.test(stripped);
}

function parseSong(content) {
  const sections = [];
  const lines = content.split("\n");
  let current = { label: null, lines: [] };

  for (const raw of lines) {
    const sectionMatch = raw.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current.lines.length || current.label) sections.push(current);
      current = { label: sectionMatch[1], lines: [] };
    } else {
      current.lines.push(raw);
    }
  }
  if (current.lines.length || current.label) sections.push(current);
  return sections;
}

function renderLyricLine(line, idx) {
  if (!line.trim()) return <div key={idx} style={{ height: "0.6em" }} />;
  if (isChordLine(line)) {
    return <div key={idx} className="chord-only-line">{line}</div>;
  }
  const parts = line.split(/(\[[A-G][^\]]*\])/g);
  return (
    <div key={idx} className="lyric-line">
      {parts.map((p, i) =>
        p.match(/^\[[A-G]/) ? <span key={i} className="chord">{p.slice(1, -1)}</span> : p
      )}
    </div>
  );
}

const AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

const StageScreen = memo(function StageScreen({ setlistId, startIdx, onExit }) {
  const { songs, setlists, settings } = useApp();
  const sl = setlists.find(s => s.id === setlistId);
  const slSongs = sl ? sl.songs.map(id => songs.find(s => s.id === id)).filter(Boolean) : [];

  const [songIdx, setSongIdx] = useState(startIdx || 0);
  const [playing, setPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [bpmOverride, setBpmOverride] = useState(null);

  const scrollRef = useRef(null);
  const autoScrollRef = useRef(null);
  const hideTimerRef = useRef(null);
  const longPressRef = useRef(null);
  const touchStartRef = useRef(null);

  const song = slSongs[songIdx];
  const bpm = bpmOverride ?? song?.bpm ?? 80;
  const sections = song ? parseSong(song.content) : [];

  const speedPxPerSec = (bpm / 60) * 16;

  useEffect(() => {
    setBpmOverride(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [songIdx]);

  useEffect(() => {
    if (playing) {
      const interval = setInterval(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop += (speedPxPerSec * 100) / 1000;
        }
      }, 100);
      autoScrollRef.current = interval;
    } else {
      clearInterval(autoScrollRef.current);
    }
    return () => clearInterval(autoScrollRef.current);
  }, [playing, speedPxPerSec]);

  useEffect(() => {
    return () => {
      clearInterval(autoScrollRef.current);
      clearTimeout(hideTimerRef.current);
    };
  }, []);

  const flashControls = useCallback(() => {
    if (locked) return;
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3500);
  }, [locked]);

  useEffect(() => { flashControls(); }, []);

  const onTouchStart = (e) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    longPressRef.current = setTimeout(() => setLocked(l => !l), 700);
  };

  const onTouchEnd = (e) => {
    clearTimeout(longPressRef.current);
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;

    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && songIdx < slSongs.length - 1) setSongIdx(i => i + 1);
      if (dx > 0 && songIdx > 0) setSongIdx(i => i - 1);
    } else if (dt < 250 && Math.abs(dx) < 15 && Math.abs(dy) < 15) {
      flashControls();
    }
    touchStartRef.current = null;
  };

  const onDoubleClick = () => setPlaying(p => !p);

  return (
    <div className="stage" data-size={settings.fontSize || "medium"}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      onDoubleClick={onDoubleClick} onClick={flashControls}>

      <div className={`stage-top ${showControls ? "" : "hidden"}`}>
        <button className="stage-exit" onClick={onExit}>✕ Salir</button>
        <span className="stage-progress">{songIdx + 1} / {slSongs.length}</span>
        {locked && <span className="locked-indicator">⊘ BLOQUEADO</span>}
      </div>

      <div className="stage-content">
        <div className="stage-scroll" ref={scrollRef}>
          <div className="stage-song-title">{song?.name}</div>
          {sections.map((sec, i) => (
            <div key={i} className="stage-section">
              {sec.label && <div className="stage-section-label">{sec.label}</div>}
              {sec.lines.map((line, j) => renderLyricLine(line, j))}
            </div>
          ))}
          <div style={{ height: "40vh" }} />
        </div>
      </div>

      <div className={`stage-controls ${showControls ? "" : "hidden"}`}>
        <div className="stage-ctrl-row">
          <div className="stage-song-nav">
            <button className="stage-btn" onClick={() => setSongIdx(i => Math.max(0, i - 1))} disabled={songIdx === 0}>← Ant</button>
            <button className="stage-btn" onClick={() => setSongIdx(i => Math.min(slSongs.length - 1, i + 1))} disabled={songIdx === slSongs.length - 1}>Sig →</button>
          </div>
          <button className={`stage-btn primary`} onClick={() => setPlaying(p => !p)}>
            {playing ? "⏸ Pausa" : "▶ Play"}
          </button>
        </div>
        <div className="stage-bpm-row">
          <span className="stage-bpm-label">BPM</span>
          <input type="range" className="bpm-slider" min={40} max={200} value={bpm}
            onChange={e => { setBpmOverride(Number(e.target.value)); }} />
          <span className="stage-bpm-val">{bpm}</span>
        </div>
      </div>
    </div>
  );
});

const SongEditor = memo(function SongEditor({ songId, onSave, onBack }) {
  const { songs, saveSong } = useApp();
  const existing = songs.find(s => s.id === songId);
  const [name, setName] = useState(existing?.name || "");
  const [bpm, setBpm] = useState(existing?.bpm || 120);
  const [key, setKey] = useState(existing?.key || "");
  const [content, setContent] = useState(existing?.content || "");

  const handleSave = () => {
    if (!name.trim()) return;
    saveSong({ id: songId || `s_${Date.now()}`, name, bpm: Number(bpm), key, content });
    onSave?.();
  };

  return (
    <div className="screen" style={{ paddingTop: 12 }}>
      <p className="section-label">Info de la canción</p>
      <div className="editor-meta">
        <div style={{ width: "100%" }}>
          <p className="input-label">Nombre</p>
          <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la canción" />
        </div>
        <div className="field-group">
          <p className="input-label">BPM</p>
          <input className="input-field" type="number" value={bpm} onChange={e => setBpm(e.target.value)} min={40} max={240} />
        </div>
        <div className="field-group">
          <p className="input-label">Tonalidad</p>
          <input className="input-field" value={key} onChange={e => setKey(e.target.value)} placeholder="Am, C, G…" />
        </div>
      </div>

      <p className="section-label">Letra y acordes</p>
      <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginBottom: 8, lineHeight: 1.6 }}>
        Usa [Coro], [Verso] para secciones. Acordes en línea propia o como [Am].
      </p>
      <textarea className="textarea-field" value={content} onChange={e => setContent(e.target.value)}
        placeholder={"[Verso 1]\nAm              F\nTu nombre en mis labios\n        C            G\ncomo una canción"} />
      <button className="save-btn" onClick={handleSave}>Guardar canción</button>
    </div>
  );
});

const SetlistScreen = memo(function SetlistScreen({ setlistId, onBack, onStage }) {
  const { songs, setlists, updateSetlist } = useApp();
  const [editingId, setEditingId] = useState(null);

  const sl = setlists.find(s => s.id === setlistId);
  if (!sl) return null;
  const slSongs = sl.songs.map(id => songs.find(s => s.id === id)).filter(Boolean);

  const removeSong = (id) => {
    updateSetlist({ ...sl, songs: sl.songs.filter(s => s !== id) });
  };

  const available = songs.filter(s => !sl.songs.includes(s.id));

  if (editingId !== null) {
    return (
      <>
        <div className="nav">
          <button className="nav-back" onClick={() => setEditingId(null)}>←</button>
          <span className="nav-title">{editingId ? "Editar canción" : "Nueva canción"}</span>
          <div style={{ width: 40 }} />
        </div>
        <SongEditor songId={editingId || null} onSave={() => setEditingId(null)} />
      </>
    );
  }

  return (
    <>
      <div className="nav">
        <button className="nav-back" onClick={onBack}>←</button>
        <span className="nav-logo">{sl.name}</span>
        <button className="nav-action" onClick={() => onStage(0)}>▶ ESCENARIO</button>
      </div>
      <div className="screen">
        <p className="section-label">{slSongs.length} canciones</p>

        {slSongs.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🎵</div>
            <p className="empty-text">Sin canciones</p>
            <p className="empty-sub">Agrega canciones a este setlist</p>
          </div>
        )}

        {slSongs.map((song, i) => (
          <div key={song.id} className="song-row">
            <span className="song-num">{i + 1}</span>
            <div className="song-info" onClick={() => setEditingId(song.id)}>
              <div className="song-name">{song.name}</div>
              <div className="song-sub">{song.key} · {song.bpm} BPM</div>
            </div>
            <button className="stage-btn" style={{ fontSize: 11, padding: "6px 10px", marginRight: 6 }}
              onClick={() => onStage(i)}>▶</button>
            <div className="bpm-chip">{song.bpm}</div>
            <button className="icon-btn" onClick={() => removeSong(song.id)}>✕</button>
          </div>
        ))}

        <p className="section-label" style={{ marginTop: 20 }}>Agregar canción</p>
        {available.map(song => (
          <div key={song.id} className="song-row" onClick={() => {
            updateSetlist({ ...sl, songs: [...sl.songs, song.id] });
          }}
            style={{ opacity: 0.6 }}>
            <span className="song-num" style={{ color: "var(--accent)" }}>+</span>
            <div className="song-info">
              <div className="song-name">{song.name}</div>
              <div className="song-sub">{song.key} · {song.bpm} BPM</div>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="save-btn" onClick={() => setEditingId("")}>+ Nueva canción</button>
        </div>
      </div>
    </>
  );
});

const SetlistsScreen = memo(function SetlistsScreen({ onOpen }) {
  const { setlists, createSetlist, deleteSetlist, activeSetlistId, setActiveSetlistId } = useApp();
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createSetlist(name);
    setName("");
    setModal(false);
  };

  return (
    <>
      <div className="nav">
        <span className="nav-logo">🎸 GigBook</span>
        <span className="nav-title">v0.2</span>
      </div>
      <div className="screen">
        <p className="section-label">{setlists.length} setlists</p>
        {setlists.length === 0 && (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <p className="empty-text">Sin setlists</p>
            <p className="empty-sub">Crea tu primer setlist con el botón +</p>
          </div>
        )}
        {setlists.map(sl => (
          <div key={sl.id} className={`setlist-card ${sl.id === activeSetlistId ? "active" : ""}`}>
            <div className="setlist-card-inner">
              <div className="setlist-card-bar" />
              <div className="setlist-card-body" onClick={() => { setActiveSetlistId(sl.id); onOpen(sl.id); }}>
                <div className="setlist-card-name">{sl.name}</div>
                <div className="setlist-card-meta">{sl.songs.length} canciones</div>
              </div>
              <div className="setlist-card-actions">
                <button className="icon-btn" onClick={() => setActiveSetlistId(sl.id)}>
                  {sl.id === activeSetlistId ? "★" : "☆"}
                </button>
                <button className="icon-btn" onClick={() => deleteSetlist(sl.id)}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="fab" onClick={() => setModal(true)}>+</button>
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <p className="modal-title">Nuevo Setlist</p>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)}
              placeholder="Nombre del setlist…" autoFocus />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={handleCreate}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

const SongsScreen = memo(function SongsScreen() {
  const { songs, deleteSong } = useApp();
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => songs.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.content || "").toLowerCase().includes(search.toLowerCase())
  ), [songs, search]);

  if (editing !== null) {
    return (
      <>
        <div className="nav">
          <button className="nav-back" onClick={() => setEditing(null)}>←</button>
          <span className="nav-title">{editing ? "Editar" : "Nueva canción"}</span>
          <div style={{ width: 40 }} />
        </div>
        <SongEditor songId={editing || null} onSave={() => setEditing(null)} />
      </>
    );
  }

  return (
    <>
      <div className="nav">
        <span className="nav-logo">Canciones</span>
        <span className="nav-title">{songs.length} total</span>
      </div>
      <div className="screen">
        <div className="search-wrap">
          <div className="search-wrap-inner">
            <span className="search-icon">🔍</span>
            <input className="search-input" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nombre, letra, acorde…" />
          </div>
        </div>
        {filtered.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🎼</div>
            <p className="empty-text">{search ? "Sin resultados" : "Sin canciones"}</p>
            <p className="empty-sub">Agrega canciones con el botón +</p>
          </div>
        )}
        {filtered.map((song, i) => (
          <div key={song.id} className="song-row">
            <span className="song-num">{i + 1}</span>
            <div className="song-info" onClick={() => setEditing(song.id)}>
              <div className="song-name">{song.name}</div>
              <div className="song-sub">{song.key} · {song.bpm} BPM</div>
            </div>
            <div className="bpm-chip">{song.bpm}</div>
            <button className="icon-btn" onClick={() => deleteSong(song.id)}>🗑</button>
          </div>
        ))}
      </div>
      <button className="fab" onClick={() => setEditing("")}>+</button>
    </>
  );
});

const QRScanner = memo(function QRScanner({ onResult, onClose }) {
  const videoRef = useRef();
  const streamRef = useRef();
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const scannerRef = useRef(null);

  useEffect(() => {
    let active = true;

    const initScanner = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scan = async () => {
            if (!active || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0) {
                const raw = codes[0].rawValue;
                if (raw.startsWith('http')) { onResult(raw); return; }
              }
            } catch {}
            if (active) requestAnimationFrame(scan);
          };
          scan();
        } else {
          setManualMode(true);
        }
      } catch {
        setManualMode(true);
      }
    };

    initScanner();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onResult]);

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      onResult(manualInput.trim());
    }
  };

  return (
    <div className="qr-overlay">
      {!manualMode ? (
        <>
          <div className="qr-viewfinder">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="qr-scan-line" />
            <div className="qr-corner tl" /><div className="qr-corner tr" />
            <div className="qr-corner bl" /><div className="qr-corner br" />
          </div>
          <p className="qr-hint">Apunta al QR que aparece en<br /><strong>http://tu-ip:3000/setup</strong></p>
          {'BarcodeDetector' in window
            ? <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>Detección automática activa</p>
            : <p style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 8 }}>Navegador no soportado. Usa entrada manual.</p>
          }
          <button className="qr-cancel" onClick={() => setManualMode(true)}>Ingresar URL manualmente</button>
        </>
      ) : (
        <div className="modal" style={{ maxWidth: 320 }}>
          <p className="modal-title">Ingresar URL del servidor</p>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
            Ingresa la URL que aparece en /setup del servidor
          </p>
          <input
            className="input-field"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="http://192.168.1.X:3000"
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleManualSubmit}>Aceptar</button>
          </div>
        </div>
      )}
      {!manualMode && <button className="qr-cancel" onClick={onClose}>Cancelar</button>}
    </div>
  );
});

const SettingsScreen = memo(function SettingsScreen() {
  const {
    songs, setlists, settings, updateSettings, exportData, importData,
    serverUrl, serverStatus, lastSyncAt, isSyncing, syncConflicts, syncError,
    setServerUrl, pingServer, syncPull, syncPush, authToken, setAuthToken,
  } = useApp();

  const fileRef = useRef();
  const [urlDraft, setUrlDraft] = useState(serverUrl || '');
  const [tokenDraft, setTokenDraft] = useState(authToken || '');
  const [showQR, setShowQR] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncingState, setSyncingState] = useState(null);

  useEffect(() => { if (serverUrl) pingServer(); }, []);

  const handleUrlSave = () => {
    setServerUrl(urlDraft.trim());
    setSyncResult(null);
  };

  const handleTokenSave = () => {
    setAuthToken(tokenDraft.trim());
    localStorage.setItem('gigbook_token', tokenDraft.trim());
  };

  const handleQRResult = (url) => {
    setShowQR(false);
    const urlObj = new URL(url);
    setUrlDraft(url);
    setServerUrl(url);
    setSyncResult(null);
  };

  const handlePull = async () => {
    setSyncResult(null);
    setSyncingState('pull');
    const r = await syncPull();
    setSyncingState(null);
    setSyncResult(r.ok ? 'pull_ok' : 'error');
  };

  const handlePush = async () => {
    setSyncResult(null);
    setSyncingState('push');
    const r = await syncPush();
    setSyncingState(null);
    setSyncResult(r.ok ? 'push_ok' : 'error');
  };

  const statusLabel = {
    unknown:  'Sin configurar',
    checking: 'Conectando…',
    online:   'Servidor en línea',
    offline:  'Servidor no disponible',
    auth_error: 'Token inválido',
  }[serverStatus];

  return (
    <>
      {showQR && <QRScanner onResult={handleQRResult} onClose={() => setShowQR(false)} />}
      {syncingState && (
        <div className="syncing-overlay">
          <div className="syncing-box">
            <div style={{ fontSize: 32 }} className="loading-spinner">⟳</div>
            <p className="syncing-text">{syncingState === 'pull' ? 'Descargando datos…' : 'Subiendo datos…'}</p>
          </div>
        </div>
      )}

      <div className="nav">
        <span className="nav-logo">Ajustes</span>
        <span className="nav-title">GigBook</span>
      </div>
      <div className="screen">

        <p className="section-label">Servidor Wi-Fi</p>

        <div style={{ marginBottom: 4 }}>
          <div className="server-status">
            <div className={`status-dot ${serverStatus === 'auth_error' ? 'offline' : serverStatus}`} />
            <span className="status-label">{statusLabel}</span>
          </div>
        </div>

        <div className="server-url-row">
          <input
            className="server-url-input"
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onBlur={handleUrlSave}
            onKeyDown={e => e.key === 'Enter' && handleUrlSave()}
            placeholder="http://192.168.1.X:3000"
          />
          <button className="qr-scan-btn" onClick={() => setShowQR(true)} title="Escanear QR">📷</button>
        </div>

        <p className="token-label">Token de sincronización</p>
        <div className="token-input-wrap">
          <input
            className="token-input"
            value={tokenDraft}
            onChange={e => setTokenDraft(e.target.value)}
            onBlur={handleTokenSave}
            onKeyDown={e => e.key === 'Enter' && handleTokenSave()}
            placeholder="Pega el token del servidor"
          />
        </div>

        <div className="sync-btn-row">
          <button className="sync-btn" onClick={handlePull}
            disabled={isSyncing || (serverStatus !== 'online' && serverStatus !== 'auth_error')}>
            {isSyncing ? '⟳' : '↓'} Obtener
          </button>
          <button className="sync-btn push" onClick={handlePush}
            disabled={isSyncing || (serverStatus !== 'online' && serverStatus !== 'auth_error')}>
            {isSyncing ? '⟳' : '↑'} Enviar
          </button>
        </div>

        {syncResult === 'pull_ok' && (
          <p className="sync-last" style={{ color: '#4caf50' }}>✓ Datos obtenidos del servidor</p>
        )}
        {syncResult === 'push_ok' && (
          <p className="sync-last" style={{ color: '#4caf50' }}>✓ Datos enviados al servidor</p>
        )}
        {syncResult === 'error' && (
          <p className="sync-last" style={{ color: 'var(--accent2)' }}>
            ✕ {syncError === 'timeout' ? 'Sin respuesta del servidor' : syncError === 'no_autorizado' ? 'Token inválido' : `Error: ${syncError}`}
          </p>
        )}
        {lastSyncAt && !syncResult && (
          <p className="sync-last">Último sync: {timeAgo(lastSyncAt)}</p>
        )}

        {syncConflicts.length > 0 && (
          <div className="conflicts-list">
            <div className="conflict-header">⚠ {syncConflicts.length} conflicto{syncConflicts.length > 1 ? 's' : ''} resuelto{syncConflicts.length > 1 ? 's' : ''}</div>
            {syncConflicts.map((c, i) => (
              <div key={i} className="conflict-row">
                <span className="conflict-name">{c.name || c.id}</span>
                <span className={`conflict-winner ${c.winner}`}>ganó {c.winner}</span>
              </div>
            ))}
          </div>
        )}

        <p className="section-label">Escenario</p>

        <div className="settings-row">
          <div>
            <div className="settings-label">Tamaño de fuente</div>
            <div className="settings-sub">Texto en modo escenario</div>
          </div>
          <select className="input-field" style={{ width: "auto", padding: "6px 10px" }}
            value={settings.fontSize || "medium"}
            onChange={e => updateSettings({ fontSize: e.target.value })}>
            <option value="small">Pequeño</option>
            <option value="medium">Mediano</option>
            <option value="large">Grande</option>
          </select>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">Auto-ocultar controles</div>
            <div className="settings-sub">Oculta controles tras 3.5s</div>
          </div>
          <button className={`toggle ${settings.autoHide !== false ? "on" : ""}`}
            onClick={() => updateSettings({ autoHide: settings.autoHide === false ? true : false })} />
        </div>

        <p className="section-label">Datos locales</p>

        <div className="settings-row">
          <div>
            <div className="settings-label">Exportar backup</div>
            <div className="settings-sub">{songs.length} canciones · {setlists.length} setlists</div>
          </div>
          <button className="stage-btn" onClick={exportData}>Exportar JSON</button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">Importar backup</div>
            <div className="settings-sub">Restaura desde JSON exportado</div>
          </div>
          <button className="stage-btn" onClick={() => fileRef.current?.click()}>Importar</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importData(f); }} />
        </div>

        <p className="version-tag">GigBook v0.2 · offline-first PWA</p>
      </div>
    </>
  );
});

const STORAGE_KEY = 'gigbook_data';
const SETTINGS_KEY = 'gigbook_settings';
const TOKEN_KEY = 'gigbook_token';

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const settings = localStorage.getItem(SETTINGS_KEY);
    return {
      songs: data ? JSON.parse(data).songs : null,
      setlists: data ? JSON.parse(data).setlists : null,
      settings: settings ? JSON.parse(settings) : null,
    };
  } catch {
    return { songs: null, setlists: null, settings: null };
  }
}

function saveToStorage(songs, setlists) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs, setlists }));
}

const SAMPLE_SONGS = [
  {
    id: "s1", name: "La Noche Que Te Fuiste", bpm: 78, key: "Am",
    content: `[Intro]\nAm  F  C  G\n\n[Verso 1]\nAm              F\nCaminé por la orilla\n        C            G\nbuscando tu silencio\nAm              F\nlas olas me decían\n        C         G\nque ya no hay regreso\n\n[Pre-Coro]\n    F          C\nPero yo me quedé\n       G         Am\nmirando el horizonte\n\n[Coro]\nAm    F     C      G\nLa noche que te fuiste\nAm    F     C      G\nme llevé tus recuerdos\nAm    F\nY no hay estrella\n    C          G\nque ilumine este miedo\n\n[Verso 2]\nAm              F\nEncendí las velas\n        C          G\nque tú misma dejaste\nAm              F\ny en cada parpadeo\n        C        G\ntu nombre me llamaste`,
    updatedAt: Date.now(),
  },
  {
    id: "s2", name: "Fuego Cruzado", bpm: 130, key: "E",
    content: `[Intro]\nE  B  C#m  A  (x2)\n\n[Verso 1]\nE                B\nDesde el primer momento\n    C#m          A\nsupe que eras distinta\nE               B\nel mundo se detuvo\n    C#m          A\ncuando me sonreíste\n\n[Coro]\nE        B\nFuego cruzado\n    C#m      A\nentre tú y yo\nE         B\nNo hay escapatoria\n    C#m          A\nen este calor\n\n[Bridge]\nC#m  B  A  E\nNo puedo respirar\nC#m  B  A  B\ncuando estás tan cerca`,
    updatedAt: Date.now(),
  },
  {
    id: "s3", name: "Amanecer Sin Ti", bpm: 68, key: "C",
    content: `[Intro]\nC  Am  F  G\n\n[Verso]\nC              Am\nDesperté sin tu aroma\n        F           G\nel café ya no sabe igual\nC              Am\nel silencio en la cama\n        F        G\nme pesa como el mar\n\n[Coro]\nF      G       C   Am\nAmanecer sin ti\nF         G        C\nes aprender a vivir\nF      G       Am\ncon cada hora que pasa\nF       G      C\nlejos de tu piel`,
    updatedAt: Date.now(),
  }
];

const SAMPLE_SETLISTS = [
  { id: "sl1", name: "Concierto Viernes", songs: ["s1", "s2", "s3"], createdAt: Date.now() - 86400000, updatedAt: Date.now() },
  { id: "sl2", name: "Ensayo Jueves", songs: ["s2", "s1"], createdAt: Date.now() - 3600000, updatedAt: Date.now() }
];

export default function App() {
  const stored = loadFromStorage();
  
  const [songs, setSongs] = useState(stored.songs || []);
  const [setlists, setSetlists] = useState(stored.setlists || []);
  const [activeSetlistId, setActiveSetlistId] = useState(null);
  const [settings, setSettings] = useState(stored.settings || { fontSize: "medium", autoHide: true });
  const [tab, setTab] = useState("sets");
  const [openSetlist, setOpenSetlist] = useState(null);
  const [stage, setStage] = useState(null);

  const [serverUrl, _setServerUrl]     = useState(() => localStorage.getItem('gigbook_server_url') || '');
  const [authToken, _setAuthToken]     = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [serverStatus, setServerStatus] = useState('unknown');
  const [lastSyncAt, setLastSyncAt]     = useState(() => { const v = localStorage.getItem('gigbook_last_sync'); return v ? Number(v) : null; });
  const [isSyncing, setIsSyncing]       = useState(false);
  const [syncConflicts, setSyncConflicts] = useState([]);
  const [syncError, setSyncError]       = useState(null);
  const apiRef = useRef(null);

  useEffect(() => {
    if (songs.length === 0 && setlists.length === 0) {
      setSongs(SAMPLE_SONGS);
      setSetlists(SAMPLE_SETLISTS);
      setActiveSetlistId(SAMPLE_SETLISTS[0].id);
    }
  }, []);

  useEffect(() => {
    saveToStorage(songs, setlists);
  }, [songs, setlists]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    apiRef.current = serverUrl ? createApi(serverUrl) : null;
  }, [serverUrl]);

  useEffect(() => { if (serverUrl) pingServer(); }, [serverUrl, authToken]);

  const setServerUrl = useCallback((url) => {
    const clean = url.trim();
    _setServerUrl(clean);
    clean ? localStorage.setItem('gigbook_server_url', clean) : localStorage.removeItem('gigbook_server_url');
    if (!clean) setServerStatus('unknown');
  }, []);

  const setAuthToken = useCallback((token) => {
    _setAuthToken(token);
  }, []);

  const pingServer = useCallback(async () => {
    if (!apiRef.current) { setServerStatus('offline'); return false; }
    setServerStatus('checking');
    const r = await apiRef.current.ping();
    if (r.needsAuth && r.error === 'no_autorizado') {
      setServerStatus('auth_error');
      return false;
    }
    setServerStatus(r.ok ? 'online' : 'offline');
    return r.ok;
  }, []);

  const syncPull = useCallback(async () => {
    if (!apiRef.current || isSyncing) return { ok: false, error: 'not_ready' };
    setIsSyncing(true); setSyncError(null); setSyncConflicts([]);
    const r = await apiRef.current.syncPull();
    if (r.needsAuth) { setServerStatus('auth_error'); setSyncError('no_autorizado'); setIsSyncing(false); return r; }
    if (!r.ok) { setServerStatus('offline'); setSyncError(r.error); setIsSyncing(false); return r; }
    const { songs: rs, setlists: rl, settings: rset } = r.data;
    const conflicts = [];
    for (const remote of (rs || [])) {
      const local = songs.find(s => s.id === remote.id);
      if (local && local.updatedAt && remote.updatedAt && local.updatedAt !== remote.updatedAt) {
        conflicts.push({ type: 'song', id: remote.id, name: remote.name || local.name, winner: (remote.updatedAt >= local.updatedAt) ? 'server' : 'client' });
      }
    }
    setSongs(prev => {
      const merged = mergeByTimestamp(prev, rs || []);
      return merged;
    });
    setSetlists(prev => {
      const merged = mergeByTimestamp(prev, rl || []);
      if (merged.length > 0 && !activeSetlistId) setActiveSetlistId(merged[0].id);
      return merged;
    });
    setSettings(prev => ({ ...prev, ...(rset || {}) }));
    setSyncConflicts(conflicts);
    setServerStatus('online');
    const ts = Date.now(); setLastSyncAt(ts); localStorage.setItem('gigbook_last_sync', String(ts));
    setIsSyncing(false);
    return { ok: true, conflicts };
  }, [songs, isSyncing, activeSetlistId]);

  const syncPush = useCallback(async () => {
    if (!apiRef.current || isSyncing) return { ok: false, error: 'not_ready' };
    setIsSyncing(true); setSyncError(null); setSyncConflicts([]);
    const now = Date.now();
    const r = await apiRef.current.syncPush({
      songs:    songs.map(s  => s.updatedAt  ? s  : { ...s,  updatedAt: now }),
      setlists: setlists.map(sl => sl.updatedAt ? sl : { ...sl, updatedAt: now }),
      settings,
    });
    if (r.needsAuth) { setServerStatus('auth_error'); setSyncError('no_autorizado'); setIsSyncing(false); return r; }
    if (!r.ok) { setServerStatus('offline'); setSyncError(r.error); setIsSyncing(false); return r; }
    const enriched = (r.data.conflicts || []).map(c => ({ ...c, name: c.name || songs.find(s => s.id === c.id)?.name || c.id }));
    setSyncConflicts(enriched);
    setServerStatus('online');
    const ts = Date.now(); setLastSyncAt(ts); localStorage.setItem('gigbook_last_sync', String(ts));
    setIsSyncing(false);
    return { ok: true, conflicts: enriched };
  }, [songs, setlists, settings, isSyncing]);

  const saveSong = useCallback((song) => {
    setSongs(prev => {
      const exists = prev.find(s => s.id === song.id);
      const updated = exists ? prev.map(s => s.id === song.id ? { ...song, updatedAt: Date.now() } : s) : [...prev, { ...song, updatedAt: Date.now() }];
      return updated;
    });
  }, []);

  const deleteSong = useCallback((id) => {
    setSongs(prev => prev.filter(s => s.id !== id));
    setSetlists(prev => prev.map(sl => ({ ...sl, songs: sl.songs.filter(s => s !== id) })));
  }, []);

  const createSetlist = useCallback((name) => {
    const sl = { id: `sl_${Date.now()}`, name, songs: [], createdAt: Date.now(), updatedAt: Date.now() };
    setSetlists(prev => [...prev, sl]);
    setActiveSetlistId(sl.id);
  }, []);

  const updateSetlist = useCallback((sl) => {
    setSetlists(prev => prev.map(s => s.id === sl.id ? { ...sl, updatedAt: Date.now() } : s));
  }, []);

  const deleteSetlist = useCallback((id) => {
    setSetlists(prev => prev.filter(s => s.id !== id));
    setActiveSetlistId(prev => prev === id ? null : prev);
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const exportData = useCallback(() => {
    const data = JSON.stringify({ songs, setlists, settings }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `gigbook-backup-${Date.now()}.json`;
    a.click();
  }, [songs, setlists, settings]);

  const importData = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { songs: s, setlists: sl, settings: st } = JSON.parse(e.target.result);
        if (s) setSongs(s);
        if (sl) setSetlists(sl);
        if (st) setSettings(st);
      } catch { alert("Error al importar el archivo."); }
    };
    reader.readAsText(file);
  }, []);

  const ctx = {
    songs, setlists, activeSetlistId, setActiveSetlistId, settings,
    saveSong, deleteSong, createSetlist, updateSetlist, deleteSetlist,
    updateSettings, exportData, importData,
    serverUrl, authToken, serverStatus, lastSyncAt, isSyncing, syncConflicts, syncError,
    setServerUrl, setAuthToken, pingServer, syncPull, syncPush,
  };

  const goStage = (setlistId, songIdx) => setStage({ setlistId, songIdx });

  return (
    <AppCtx.Provider value={ctx}>
      <Suspense fallback={null}>
        <FontLink />
      </Suspense>
      <div className="app" data-size={settings.fontSize || "medium"}>

        {stage && (
          <StageScreen
            setlistId={stage.setlistId}
            startIdx={stage.songIdx}
            onExit={() => setStage(null)}
          />
        )}

        {!stage && openSetlist && (
          <SetlistScreen
            setlistId={openSetlist}
            onBack={() => setOpenSetlist(null)}
            onStage={(idx) => goStage(openSetlist, idx)}
          />
        )}

        {!stage && !openSetlist && (
          <>
            {tab === "sets" && <SetlistsScreen onOpen={id => setOpenSetlist(id)} />}
            {tab === "songs" && <SongsScreen />}
            {tab === "settings" && <SettingsScreen />}

            <nav className="tabs">
              {[
                { id: "sets", icon: "📋", label: "Setlists" },
                { id: "songs", icon: "🎵", label: "Canciones" },
                { id: "settings", icon: "⚙️", label: "Ajustes" },
              ].map(t => (
                <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                  <span className="tab-icon">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </AppCtx.Provider>
  );
}
