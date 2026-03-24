import { useState, useEffect, useRef, useCallback, memo, createContext, useContext, useMemo, lazy, Suspense } from "react";
import "./styles.css";

const TIMEOUT_MS = 5000;

async function apiRequest(baseUrl, path, options = {}) {
  const token = localStorage.getItem('gigbook_token') || '';
  const MAX_RETRIES = 4;
  const BACKOFF = [0, 2000, 4000, 8000, 16000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BACKOFF[attempt + 1]));
        continue;
      }
      return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'network_error') };
    }
  }
  return { ok: false, error: 'network_error' };
}

function createApi(baseUrl) {
  const url = baseUrl.replace(/\/$/, '');
  return {
    ping:     ()     => apiRequest(url, '/api/ping'),
    verify:   ()     => apiRequest(url, '/api/verify'),
    syncPull: ()     => apiRequest(url, '/api/sync'),
    syncPush: (body) => apiRequest(url, '/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  };
}

function mergeByTimestamp(local, remote) {
  const map = new Map();
  for (const item of local) map.set(item.id, item);
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l || (r.updatedAt || 0) >= (l.updatedAt || 0)) map.set(r.id, r);
  }
  return Array.from(map.values());
}

function timeAgo(ts) {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 10)    return 'ahora mismo';
  if (d < 60)    return `hace ${d}s`;
  if (d < 3600)  return `hace ${Math.floor(d / 60)}min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)}h`;
  return `hace ${Math.floor(d / 86400)}d`;
}

const FontLink = lazy(() => import('./components/FontLink.jsx'));

const CHORD_RE = /\b([A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add[0-9]*|maj[37]|m[37]|7|9|11|13)?(?:\/[A-G][#b]?)?)\b/gi;

function isChordLine(line) {
  const stripped = line.trim();
  if (!stripped) return false;
  const cleaned = stripped.replace(CHORD_RE, "").replace(/[\s|]+/g, "").trim();
  return cleaned.length === 0 && CHORD_RE.test(stripped);
}

function parseSong(content) {
  const sections = [];
  const lines = content.split("\n");
  let current = { label: null, lines: [] };
  for (const raw of lines) {
    const m = raw.match(/^\[(.+)\]$/);
    if (m) {
      if (current.lines.length || current.label) sections.push(current);
      current = { label: m[1], lines: [] };
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

// ─── Sync Indicator ──────────────────────────────────────────────────────────
function SyncIndicator({ status, className }) {
  const icons = { synced: '✓', syncing: '⟳', offline: '!', not_configured: '–' };
  const titles = { synced: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sin conexión', not_configured: 'Sin servidor' };
  return (
    <div className={`sync-indicator ${status} ${className || ''}`} title={titles[status]}>
      <span className={status === 'syncing' ? 'loading-spinner' : ''}>{icons[status]}</span>
    </div>
  );
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────
function ConfirmDialog({ message, confirmLabel = "Eliminar", onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <p className="modal-title">{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Song Detail (read-only) ─────────────────────────────────────────────────
const SongDetail = memo(function SongDetail({ songId, onBack, onEdit, onStage }) {
  const { songs } = useApp();
  const song = songs.find(s => s.id === songId);
  if (!song) return null;
  const sections = parseSong(song.content || "");

  return (
    <>
      <div className="nav">
        <button className="nav-back" onClick={onBack}>←</button>
        <span className="nav-title" style={{ flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {song.name}
        </span>
        <button className="nav-action" onClick={onEdit}>Editar</button>
      </div>
      <div className="screen detail-view" style={{ paddingTop: 8 }}>
        <div className="song-detail-meta">
          {song.key  && <span className="song-detail-chip">{song.key}</span>}
          {song.bpm  && <span className="song-detail-chip">{song.bpm} BPM</span>}
          {onStage   && <button className="song-detail-stage" onClick={onStage}>▶ Escenario</button>}
        </div>
        {sections.map((sec, i) => (
          <div key={i} className="detail-section">
            {sec.label && <div className="detail-section-label">{sec.label}</div>}
            {sec.lines.map((line, j) => renderLyricLine(line, j))}
          </div>
        ))}
        <div style={{ height: 40 }} />
      </div>
    </>
  );
});

// ─── Stage Screen ─────────────────────────────────────────────────────────────
const StageScreen = memo(function StageScreen({ setlistId, startIdx, onExit, serverStatus: externalServerStatus }) {
  const { songs, setlists, settings, serverUrl } = useApp();
  const [connStatus, setConnStatus] = useState(externalServerStatus || 'unknown');
  const pingIntervalRef = useRef(null);
  const sl = setlists.find(s => s.id === setlistId);
  const slSongs = sl ? sl.songs.map(id => songs.find(s => s.id === id)).filter(Boolean) : [];

  const [songIdx, setSongIdx]       = useState(startIdx || 0);
  const [playing, setPlaying]       = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [locked, setLocked]         = useState(false);
  const [bpmOverride, setBpmOverride] = useState(null);
  const [showHint, setShowHint]     = useState(() => !localStorage.getItem('gigbook_stage_hint'));
  const [pendingSong, setPendingSong] = useState(null);
  const [boundaryFlash, setBoundaryFlash] = useState(null); // 'first'|'last'

  const scrollRef     = useRef(null);
  const hideTimerRef  = useRef(null);
  const longPressRef  = useRef(null);
  const touchStartRef = useRef(null);

  const song = slSongs[songIdx];
  const bpm  = bpmOverride ?? song?.bpm ?? 80;
  const sections = song ? parseSong(song.content) : [];
  const speedPxPerSec = (bpm / 60) * 16;
  const autoHide = settings.autoHide !== false;

  // Dismiss hint after 4s
  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => {
      setShowHint(false);
      localStorage.setItem('gigbook_stage_hint', '1');
    }, 4000);
    return () => clearTimeout(t);
  }, [showHint]);

  // Heartbeat: ping server every 10s in stage mode
  useEffect(() => {
    const ping = async () => {
      if (!serverUrl) return;
      try {
        const token = localStorage.getItem('gigbook_token') || '';
        const res = await fetch(`${serverUrl}/api/ping`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        setConnStatus(res.ok ? 'online' : 'offline');
      } catch {
        setConnStatus('offline');
      }
    };
    ping();
    pingIntervalRef.current = setInterval(ping, 10000);
    return () => clearInterval(pingIntervalRef.current);
  }, [serverUrl]);

  const connDotClass = { online: 'stage-conn-online', offline: 'stage-conn-offline', checking: 'stage-conn-checking', auth_error: 'stage-conn-error' }[connStatus] || 'stage-conn-offline';
  const connLabel = { online: 'Conectado', offline: 'Sin conexión', checking: 'Verificando…', auth_error: 'Token inválido', unknown: '?' }[connStatus] || '?';

  useEffect(() => {
    setBpmOverride(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [songIdx]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (scrollRef.current) scrollRef.current.scrollTop += speedPxPerSec / 30;
    }, 33);
    return () => clearInterval(id);
  }, [playing, speedPxPerSec]);

  useEffect(() => () => {
    clearTimeout(hideTimerRef.current);
  }, []);

  // Boundary flash auto-dismiss
  useEffect(() => {
    if (!boundaryFlash) return;
    const t = setTimeout(() => setBoundaryFlash(null), 1200);
    return () => clearTimeout(t);
  }, [boundaryFlash]);

  const flashControls = useCallback(() => {
    if (locked) return;
    setShowControls(true);
    if (!autoHide) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3500);
  }, [locked, autoHide]);

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
      if (!locked) {
        if (dx < 0 && songIdx < slSongs.length - 1) setPendingSong({ idx: songIdx + 1, dir: 'next' });
        else if (dx > 0 && songIdx > 0) setPendingSong({ idx: songIdx - 1, dir: 'prev' });
        else setBoundaryFlash(dx < 0 ? 'last' : 'first');
      }
    } else if (dt < 250 && Math.abs(dx) < 15 && Math.abs(dy) < 15) {
      flashControls();
    }
    touchStartRef.current = null;
  };

  const navigateSong = (idx) => {
    if (idx === songIdx) return;
    setPendingSong({ idx, dir: idx > songIdx ? 'next' : 'prev' });
  };

  const confirmSong = (idx) => {
    setSongIdx(idx);
    setPlaying(false);
    setBpmOverride(null);
    setPendingSong(null);
  };

  const dismissHint = () => {
    setShowHint(false);
    localStorage.setItem('gigbook_stage_hint', '1');
  };

  return (
    <div className="stage" data-size={settings.fontSize || "medium"}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      onDoubleClick={() => !locked && setPlaying(p => !p)} onClick={flashControls}>

      {/* Gesture hint overlay – first time only */}
      {showHint && (
        <div className="stage-hint" onClick={dismissHint}>
          <div className="stage-hint-box">
            <div className="stage-hint-row">← deslizar → · Cambiar canción</div>
            <div className="stage-hint-row">Doble toque · Play / Pausa</div>
            <div className="stage-hint-row">Mantener · Bloquear pantalla</div>
            <div className="stage-hint-sub">Toca para cerrar</div>
          </div>
        </div>
      )}

      {/* Back button */}
      <button className="stage-back-btn" onClick={onExit} aria-label="Salir de escenario">← Salir</button>

      <div className={`stage-top ${showControls ? "" : "hidden"}`}>
        <span className="stage-progress">{songIdx + 1} / {slSongs.length}</span>
        <div className="stage-conn-indicator" title={connLabel}>
          <div className={`stage-conn-dot ${connDotClass}`} />
          <span className="stage-conn-label">{connLabel}</span>
        </div>
        {locked && <span className="locked-indicator">⊘ BLOQUEADO</span>}
      </div>

      {/* Boundary flash feedback */}
      {boundaryFlash && (
        <div className="stage-boundary-flash">
          {boundaryFlash === 'first' ? 'Primera canción' : 'Última canción'}
        </div>
      )}

      {/* Song transition card */}
      {pendingSong && (
        <div className="stage-song-card" onClick={() => setPendingSong(null)}>
          <div className="stage-song-card-inner" onClick={e => e.stopPropagation()}>
            <div className="stage-song-card-dir">{pendingSong.dir === 'next' ? 'Siguiente →' : '← Anterior'}</div>
            <div className="stage-song-card-title">{slSongs[pendingSong.idx]?.name}</div>
            <button className="stage-btn primary stage-song-card-play" onClick={() => confirmSong(pendingSong.idx)}>▶ Play</button>
            <button className="stage-btn stage-song-card-cancel" onClick={() => setPendingSong(null)}>Cancelar</button>
          </div>
        </div>
      )}

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
            <button className="stage-btn" onClick={() => navigateSong(Math.max(0, songIdx - 1))} disabled={songIdx === 0} aria-label="Canción anterior">← Ant</button>
            <button className="stage-btn" onClick={() => navigateSong(Math.min(slSongs.length - 1, songIdx + 1))} disabled={songIdx === slSongs.length - 1} aria-label="Canción siguiente">Sig →</button>
          </div>
          <span className="stage-current-song">{song?.name}</span>
          <button className="stage-btn primary" onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pausar" : "Reproducir"}>
            {playing ? "⏸ Pausa" : "▶ Play"}
          </button>
        </div>
        <div className="stage-bpm-row">
          <span className="stage-bpm-label">BPM</span>
          <input type="range" className="bpm-slider" min={40} max={200} value={bpm}
            onChange={e => setBpmOverride(Number(e.target.value))} disabled={locked} aria-label="Velocidad BPM" />
          <span className="stage-bpm-val">{bpm}</span>
        </div>
      </div>
    </div>
  );
});

// ─── Song Editor ──────────────────────────────────────────────────────────────
const SongEditor = memo(function SongEditor({ songId, onSave, onBack }) {
  const { songs, saveSong } = useApp();
  const existing = songs.find(s => s.id === songId);
  const [name, setName]       = useState(existing?.name || "");
  const [bpm, setBpm]         = useState(existing?.bpm  || 120);
  const [key, setKey]         = useState(existing?.key  || "");
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

// ─── Setlist Screen ───────────────────────────────────────────────────────────
const SetlistScreen = memo(function SetlistScreen({ setlistId, onBack, onStage }) {
  const { songs, setlists, updateSetlist } = useApp();
  const [mode, setMode]           = useState(null);
  const [addModal, setAddModal]   = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [dragIdx, setDragIdx]   = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const UNDO_TIMEOUT = 5000;

  const sl = setlists.find(s => s.id === setlistId);
  if (!sl) return null;
  const slSongs   = sl.songs.map(id => songs.find(s => s.id === id)).filter(Boolean);
  const available = songs.filter(s => !sl.songs.includes(s.id));
  const filteredAvailable = addSearch
    ? available.filter(s => s.name.toLowerCase().includes(addSearch.toLowerCase()))
    : available;

  const removeSong = (id) => {
    const updated = { ...sl, songs: sl.songs.filter(s => s !== id) };
    updateSetlist(updated);
    setUndoStack(prev => [...prev, { action: 'removeSong', slId: sl.id, songId: id, prevSongs: sl.songs }]);
    setTimeout(() => setUndoStack(prev => prev.slice(1)), UNDO_TIMEOUT);
    setConfirmRemove(null);
  };

  const undoLast = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || last.slId !== sl.id) return;
    updateSetlist({ ...sl, songs: last.prevSongs });
    setUndoStack(prev => prev.slice(0, -1));
  };

  const onDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const onDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null); setDragOverIdx(null); return;
    }
    const newSongs = [...sl.songs];
    const [moved] = newSongs.splice(dragIdx, 1);
    newSongs.splice(idx, 0, moved);
    updateSetlist({ ...sl, songs: newSongs });
    setDragIdx(null); setDragOverIdx(null);
  };

  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const canUndo = undoStack.length > 0 && undoStack[undoStack.length - 1]?.slId === sl.id;

  // Song detail view
  if (mode?.type === 'view') {
    return (
      <SongDetail
        songId={mode.songId}
        onBack={() => setMode(null)}
        onEdit={() => setMode({ type: 'edit', songId: mode.songId })}
        onStage={() => onStage(slSongs.findIndex(s => s.id === mode.songId))}
      />
    );
  }

  // Song edit view
  if (mode?.type === 'edit') {
    return (
      <>
        <div className="nav">
          <button className="nav-back" onClick={() => setMode({ type: 'view', songId: mode.songId })}>←</button>
          <span className="nav-title">Editar canción</span>
          <div style={{ width: 40 }} />
        </div>
        <SongEditor songId={mode.songId} onSave={() => setMode(null)} />
      </>
    );
  }

  // New song view
  if (mode?.type === 'new') {
    return (
      <>
        <div className="nav">
          <button className="nav-back" onClick={() => setMode(null)}>←</button>
          <span className="nav-title">Nueva canción</span>
          <div style={{ width: 40 }} />
        </div>
        <SongEditor songId={null} onSave={() => setMode(null)} />
      </>
    );
  }

  return (
    <>
      <div className="nav">
        <button className="nav-back" onClick={onBack}>←</button>
        <span className="nav-logo" style={{ flex: 1, textAlign: "center", fontSize: 14 }}>{sl.name}</span>
        {canUndo && (
          <button className="nav-back" style={{ color: "var(--accent)", fontSize: 13 }} onClick={undoLast} title="Deshacer">
            ↩ Deshacer
          </button>
        )}
        <button className="nav-action" onClick={() => onStage(0)} disabled={slSongs.length === 0}>▶ ESCENARIO</button>
      </div>
      <div className="screen">
        <p className="section-label">{slSongs.length} canciones</p>

        {slSongs.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🎵</div>
            <p className="empty-text">Sin canciones</p>
            <p className="empty-sub">Agrega canciones con el botón +</p>
          </div>
        )}

        {slSongs.map((song, i) => (
          <div
            key={song.id}
            className={`song-row${dragOverIdx === i ? ' drag-over' : ''}${dragIdx === i ? ' dragging' : ''}`}
            draggable
            onDragStart={e => onDragStart(e, i)}
            onDragOver={e => onDragOver(e, i)}
            onDrop={e => onDrop(e, i)}
            onDragEnd={onDragEnd}
            style={{ cursor: 'grab' }}
          >
            <span className="song-num" style={{ cursor: 'grab' }}>☰ {i + 1}</span>
            <div className="song-info" onClick={() => setMode({ type: 'view', songId: song.id })}>
              <div className="song-name">{song.name}</div>
              <div className="song-sub">{[song.key, song.bpm && `${song.bpm} BPM`].filter(Boolean).join(' · ')}</div>
            </div>
            <button className="stage-btn" style={{ fontSize: 11, padding: "6px 10px" }}
              onClick={() => onStage(i)}>▶</button>
            <button className="icon-btn" onClick={() => setConfirmRemove(song.id)} aria-label="Quitar del setlist">✕</button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="save-btn" style={{ flex: 1 }} onClick={() => { setAddSearch(""); setAddModal(true); }}>
            + Agregar canción
          </button>
          <button className="save-btn" style={{ flex: 1, background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)" }}
            onClick={() => setMode({ type: 'new' })}>
            + Nueva canción
          </button>
        </div>
      </div>

      {/* Add song modal */}
      {addModal && (
        <div className="modal-overlay" onClick={() => setAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <p className="modal-title">Agregar al setlist</p>
            <input className="input-field" value={addSearch} onChange={e => setAddSearch(e.target.value)}
              placeholder="Buscar canción…" autoFocus style={{ marginBottom: 8 }} />
            <div className="add-song-list">
              {filteredAvailable.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 0", textAlign: "center" }}>
                  {addSearch ? "Sin resultados" : "Todas las canciones ya están en el setlist"}
                </p>
              )}
              {filteredAvailable.map(song => (
                <div key={song.id} className="add-song-item" onClick={() => {
                  updateSetlist({ ...sl, songs: [...sl.songs, song.id] });
                  setAddModal(false);
                }}>
                  <div>
                    <div className="add-song-name">{song.name}</div>
                    <div className="add-song-meta">{[song.key, song.bpm && `${song.bpm} BPM`].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setAddModal(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="¿Quitar esta canción del setlist?"
          confirmLabel="Quitar"
          onConfirm={() => removeSong(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </>
  );
});

// ─── Setlists Screen ──────────────────────────────────────────────────────────
const SetlistsScreen = memo(function SetlistsScreen({ onOpen }) {
  const { setlists, createSetlist, deleteSetlist } = useApp();
  const [modal, setModal]               = useState(false);
  const [name, setName]                 = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

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
        <span className="nav-title">v0.3</span>
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
          <div key={sl.id} className="setlist-card">
            <div className="setlist-card-inner">
              <div className="setlist-card-bar" />
              <div className="setlist-card-body" onClick={() => onOpen(sl.id)}>
                <div className="setlist-card-name">{sl.name}</div>
                <div className="setlist-card-meta">{sl.songs.length} canciones</div>
              </div>
              <div className="setlist-card-actions">
                <button className="icon-btn" onClick={() => setConfirmDelete(sl.id)} aria-label="Eliminar setlist">🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="fab" onClick={() => { setName(""); setModal(true); }}>+</button>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <p className="modal-title">Nuevo Setlist</p>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)}
              placeholder="Nombre del setlist…" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={handleCreate}>Crear</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message="¿Eliminar este setlist?"
          onConfirm={() => { deleteSetlist(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
});

// ─── Songs Screen ─────────────────────────────────────────────────────────────
const SongsScreen = memo(function SongsScreen() {
  const { songs, deleteSong } = useApp();
  // mode: null | { type: 'view'|'edit'|'new', songId? }
  const [mode, setMode]                 = useState(null);
  const [search, setSearch]             = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const filtered = useMemo(() => songs.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.content || "").toLowerCase().includes(search.toLowerCase())
  ), [songs, search]);

  if (mode?.type === 'view') {
    return (
      <SongDetail
        songId={mode.songId}
        onBack={() => setMode(null)}
        onEdit={() => setMode({ type: 'edit', songId: mode.songId })}
      />
    );
  }

  if (mode?.type === 'edit' || mode?.type === 'new') {
    const isNew = mode.type === 'new';
    return (
      <>
        <div className="nav">
          <button className="nav-back" onClick={() => isNew ? setMode(null) : setMode({ type: 'view', songId: mode.songId })}>←</button>
          <span className="nav-title">{isNew ? "Nueva canción" : "Editar"}</span>
          <div style={{ width: 40 }} />
        </div>
        <SongEditor songId={isNew ? null : mode.songId} onSave={() => setMode(null)} />
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
            <div className="song-info" onClick={() => setMode({ type: 'view', songId: song.id })}>
              <div className="song-name">{song.name}</div>
              <div className="song-sub">{[song.key, song.bpm && `${song.bpm} BPM`].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="bpm-chip">{song.bpm}</div>
            <button className="icon-btn" onClick={() => setConfirmDelete(song.id)} aria-label="Eliminar canción">🗑</button>
          </div>
        ))}
      </div>

      <button className="fab" onClick={() => setMode({ type: 'new' })}>+</button>

      {confirmDelete && (
        <ConfirmDialog
          message="¿Eliminar esta canción?"
          onConfirm={() => { deleteSong(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
});

// ─── QR Scanner ───────────────────────────────────────────────────────────────
const QRScanner = memo(function QRScanner({ onResult, onClose }) {
  const videoRef  = useRef();
  const streamRef = useRef();
  const canScan   = window.isSecureContext && !!navigator.mediaDevices;
  const [manualMode,  setManualMode]  = useState(!canScan);
  const [manualInput, setManualInput] = useState("");
  const [cameraErr,   setCameraErr]   = useState(!canScan ? 'La cámara requiere HTTPS. Ingresa la URL manualmente.' : '');

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!canScan) return;
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
              if (codes.length > 0 && codes[0].rawValue.startsWith('http')) {
                onResult(codes[0].rawValue); return;
              }
            } catch {}
            if (active) requestAnimationFrame(scan);
          };
          scan();
        } else {
          setCameraErr('Navegador no soportado para escaneo automático.');
          setManualMode(true);
        }
      } catch {
        setCameraErr('No se pudo acceder a la cámara.');
        setManualMode(true);
      }
    };
    initScanner();
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [canScan, onResult]);

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
          <p className="qr-hint">Apunta al QR del panel de GigBook Server</p>
          <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>Detección automática activa</p>
          <button className="qr-cancel" onClick={() => setManualMode(true)}>Ingresar URL manualmente</button>
          <button className="qr-cancel" onClick={onClose}>Cancelar</button>
        </>
      ) : (
        <div className="modal" style={{ maxWidth: 340 }}>
          <p className="modal-title">Conectar al servidor</p>
          {cameraErr && (
            <p style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 12, lineHeight: 1.5 }}>
              ⚠️ {cameraErr}
            </p>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
            Ingresa la URL que aparece en el panel de escritorio (ej: <code style={{color:'var(--accent)'}}>http://192.168.0.X:3000</code>)
          </p>
          <input className="input-field" value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder="http://192.168.0.X:3000" autoFocus
            onKeyDown={e => e.key === 'Enter' && manualInput.trim() && onResult(manualInput.trim())} />
          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={() => manualInput.trim() && onResult(manualInput.trim())}>Conectar</button>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Settings Screen ──────────────────────────────────────────────────────────
const SettingsScreen = memo(function SettingsScreen() {
  const {
    songs, setlists, settings, updateSettings, exportData, importData,
    serverUrl, serverStatus, lastSyncAt, isSyncing, syncConflicts, syncError,
    setServerUrl, pingServer, syncPull, syncPush, syncBidirectional, authToken, setAuthToken,
  } = useApp();

  const fileRef = useRef();
  const [urlDraft, setUrlDraft]     = useState(serverUrl || '');
  const [tokenDraft, setTokenDraft] = useState(authToken || '');
  const [showQR, setShowQR]         = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncingState, setSyncingState] = useState(null);
  const [confirmPull, setConfirmPull] = useState(false);

  useEffect(() => { if (serverUrl) pingServer(); }, []);

  const handleUrlSave = () => {
    setServerUrl(urlDraft.trim());
    setSyncResult(null);
  };

  const handleTokenSave = () => {
    setAuthToken(tokenDraft.trim());
    localStorage.setItem('gigbook_token', tokenDraft.trim());
  };

  // Parse URL — extracts clean URL and optional autotoken param
  const handleQRResult = (raw) => {
    setShowQR(false);
    try {
      const urlObj = new URL(raw);
      const autotoken = urlObj.searchParams.get('autotoken');
      const cleanUrl = `${urlObj.protocol}//${urlObj.host}`;
      setUrlDraft(cleanUrl);
      setServerUrl(cleanUrl);
      if (autotoken) {
        setTokenDraft(autotoken);
        setAuthToken(autotoken);
        localStorage.setItem('gigbook_token', autotoken);
      }
    } catch {
      setUrlDraft(raw);
      setServerUrl(raw);
    }
    setSyncResult(null);
  };

  const handleSync = async () => {
    setSyncResult(null);
    setSyncingState('sync');
    const r = await syncBidirectional();
    setSyncingState(null);
    setSyncResult(r.ok ? 'sync_ok' : 'error');
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
    unknown:    'Sin configurar',
    checking:   'Conectando…',
    online:     'Servidor en línea',
    offline:    'Servidor no disponible',
    auth_error: 'Token inválido',
  }[serverStatus];

  const canSync = !isSyncing && !!serverUrl;

  return (
    <>
      {showQR && <QRScanner onResult={handleQRResult} onClose={() => setShowQR(false)} />}
      {syncingState && (
        <div className="syncing-overlay">
          <div className="syncing-box">
            <div style={{ fontSize: 32 }} className="loading-spinner">⟳</div>
            <p className="syncing-text">
              {syncingState === 'sync' ? 'Sincronizando…' : syncingState === 'pull' ? 'Descargando datos…' : 'Subiendo datos…'}
            </p>
          </div>
        </div>
      )}

      <div className="nav">
        <span className="nav-logo">Ajustes</span>
        <span className="nav-title">GigBook</span>
      </div>
      <div className="screen">

        <p className="section-label">Servidor Wi-Fi</p>

        <div className="server-status" style={{ marginBottom: 10 }}>
          <div className={`status-dot ${serverStatus === 'auth_error' ? 'offline' : serverStatus}`} />
          <span className="status-label">{statusLabel}</span>
        </div>

        <div className="server-url-row">
          <input className="server-url-input" value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
            onBlur={handleUrlSave} onKeyDown={e => e.key === 'Enter' && handleUrlSave()}
            placeholder="http://192.168.1.X:3000" />
          <button className="qr-scan-btn" onClick={() => setShowQR(true)} title="Conectar al servidor">
            {window.isSecureContext ? '📷' : '🔗'}
          </button>
        </div>

        <p className="token-label">Token de sincronización</p>
        <div className="token-input-wrap">
          <input className="token-input" value={tokenDraft}
            onChange={e => setTokenDraft(e.target.value)}
            onBlur={handleTokenSave} onKeyDown={e => e.key === 'Enter' && handleTokenSave()}
            placeholder="Pega el token o escanea el QR del servidor" />
        </div>

        {/* Primary: bidirectional sync */}
        <button className="sync-btn-main" onClick={handleSync} disabled={!canSync}>
          ⇄ Sincronizar
        </button>

        {/* Secondary: directional */}
        <div className="sync-btn-row">
          <button className="sync-btn" onClick={() => setConfirmPull(true)} disabled={!canSync}>
            {isSyncing ? '⟳' : '↓'} Del servidor
          </button>
          <button className="sync-btn push" onClick={handlePush} disabled={!canSync}>
            {isSyncing ? '⟳' : '↑'} Al servidor
          </button>
        </div>

        {syncResult === 'sync_ok' && <p className="sync-last" style={{ color: '#4caf50' }}>✓ Sincronizado correctamente</p>}
        {syncResult === 'pull_ok' && <p className="sync-last" style={{ color: '#4caf50' }}>✓ Datos descargados del servidor</p>}
        {syncResult === 'push_ok' && <p className="sync-last" style={{ color: '#4caf50' }}>✓ Datos subidos al servidor</p>}
        {syncResult === 'error'   && (
          <p className="sync-last" style={{ color: 'var(--accent2)' }}>
            ✕ {syncError === 'timeout' ? 'Sin respuesta del servidor'
              : syncError === 'no_autorizado' ? 'Token inválido'
              : `Error: ${syncError}`}
          </p>
        )}
        {lastSyncAt && !syncResult && (
          <p className="sync-last">Último sync: {timeAgo(lastSyncAt)}</p>
        )}

        {syncConflicts.length > 0 && (
          <div className="conflicts-list">
            <div className="conflict-header">⇄ {syncConflicts.length} conflicto{syncConflicts.length > 1 ? 's' : ''} — ganó el más reciente</div>
            {syncConflicts.map((c, i) => (
              <div key={i} className="conflict-row">
                <span className="conflict-name">{c.name || c.id}</span>
                <span className={`conflict-winner ${c.winner}`}>ganó {c.winner === 'server' ? 'servidor' : 'este dispositivo'}</span>
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
            <div className="settings-sub">Oculta controles tras 3.5s en escenario</div>
          </div>
          <button className={`toggle ${settings.autoHide !== false ? "on" : ""}`}
            onClick={() => updateSettings({ autoHide: settings.autoHide === false })} />
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

        <p className="version-tag">GigBook v0.3 · offline-first PWA</p>
      </div>

      {confirmPull && (
        <ConfirmDialog
          message="¿Descargar datos del servidor? Esto sobrescribirá tus datos locales con los del servidor."
          confirmLabel="Descargar"
          onConfirm={() => { setConfirmPull(false); handlePull(); }}
          onCancel={() => setConfirmPull(false)}
        />
      )}
    </>
  );
});

// ─── Data / Storage ───────────────────────────────────────────────────────────
const STORAGE_KEY  = 'gigbook_data';
const SETTINGS_KEY = 'gigbook_settings';
const TOKEN_KEY    = 'gigbook_token';

function loadFromStorage() {
  try {
    const data     = localStorage.getItem(STORAGE_KEY);
    const settings = localStorage.getItem(SETTINGS_KEY);
    return {
      songs:    data ? JSON.parse(data).songs    : null,
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
    content: `[Intro]\nAm  F  C  G\n\n[Verso 1]\nAm              F\nCaminé por la orilla\n        C            G\nbuscando tu silencio\nAm              F\nlas olas me decían\n        C         G\nque ya no hay regreso\n\n[Pre-Coro]\n    F          C\nPero yo me quedé\n       G         Am\nmirando el horizonte\n\n[Coro]\nAm    F     C      G\nLa noche que te fuiste\nAm    F     C      G\nme llevé tus recuerdos\nAm    F\nY no hay estrella\n    C          G\nque ilumine este miedo`,
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
  },
];

const SAMPLE_SETLISTS = [
  { id: "sl1", name: "Concierto Viernes", songs: ["s1", "s2", "s3"], createdAt: Date.now() - 86400000, updatedAt: Date.now() },
  { id: "sl2", name: "Ensayo Jueves",     songs: ["s2", "s1"],       createdAt: Date.now() - 3600000,  updatedAt: Date.now() },
];

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const stored = loadFromStorage();

  const [songs, setSongs]       = useState(stored.songs    || []);
  const [setlists, setSetlists] = useState(stored.setlists || []);
  const [settings, setSettings] = useState(stored.settings || { fontSize: "medium", autoHide: true });
  const [tab, setTab]           = useState("sets");
  const [openSetlist, setOpenSetlist] = useState(null);
  const [stage, setStage]       = useState(null);

  const [serverUrl, _setServerUrl]  = useState(() => localStorage.getItem('gigbook_server_url') || '');
  const [authToken, _setAuthToken]  = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [serverStatus, setServerStatus] = useState('unknown');
  const [lastSyncAt, setLastSyncAt] = useState(() => { const v = localStorage.getItem('gigbook_last_sync'); return v ? Number(v) : null; });
  const [isSyncing, setIsSyncing]   = useState(false);
  const [syncConflicts, setSyncConflicts] = useState([]);
  const [syncError, setSyncError]   = useState(null);
  const [syncStatus, setSyncStatus] = useState('not_configured');
  const [toastMsg, setToastMsg]     = useState(null);
  const apiRef     = useRef(null);
  const syncRef    = useRef(null);
  const isSyncRef  = useRef(false);

  // Load sample data on first run
  useEffect(() => {
    if (songs.length === 0 && setlists.length === 0) {
      setSongs(SAMPLE_SONGS);
      setSetlists(SAMPLE_SETLISTS);
    }
  }, []);

  useEffect(() => { saveToStorage(songs, setlists); }, [songs, setlists]);
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { apiRef.current = serverUrl ? createApi(serverUrl) : null; }, [serverUrl]);
  useEffect(() => { if (serverUrl) pingServer(); }, [serverUrl, authToken]);

  // Keep refs current for auto-sync interval
  useEffect(() => { isSyncRef.current = isSyncing; }, [isSyncing]);

  // Auto-sync every 30s when online
  useEffect(() => {
    if (!serverUrl || !authToken) { setSyncStatus('not_configured'); return; }
    if (serverStatus !== 'online') { setSyncStatus(serverStatus === 'checking' ? 'syncing' : 'offline'); return; }
    setSyncStatus('synced');

    const tick = async () => {
      if (isSyncRef.current) return;
      if (document.querySelector('.modal-overlay, .syncing-overlay, .editor-meta')) return;
      setSyncStatus('syncing');
      const r = await syncRef.current?.();
      if (!r) return;
      setSyncStatus(r.ok ? 'synced' : 'offline');
      if (r.ok) { setToastMsg('✓ Sincronizado'); setTimeout(() => setToastMsg(null), 3000); }
    };
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [serverUrl, authToken, serverStatus]);

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
    if (r.needsAuth) { setServerStatus('auth_error'); return false; }
    setServerStatus(r.ok ? 'online' : 'offline');
    return r.ok;
  }, []);

  const syncPull = useCallback(async () => {
    if (!apiRef.current || isSyncing) return { ok: false, error: 'not_ready' };
    setIsSyncing(true); setSyncError(null); setSyncConflicts([]);
    const r = await apiRef.current.syncPull();
    if (r.needsAuth) { setServerStatus('auth_error'); setSyncError('no_autorizado'); setIsSyncing(false); return r; }
    if (!r.ok)       { setServerStatus('offline');    setSyncError(r.error);          setIsSyncing(false); return r; }
    const { songs: rs, setlists: rl, settings: rset } = r.data;
    setSongs(prev => mergeByTimestamp(prev, rs || []));
    setSetlists(prev => mergeByTimestamp(prev, rl || []));
    setSettings(prev => ({ ...prev, ...(rset || {}) }));
    setServerStatus('online');
    const ts = Date.now(); setLastSyncAt(ts); localStorage.setItem('gigbook_last_sync', String(ts));
    setIsSyncing(false);
    return { ok: true };
  }, [isSyncing]);

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
    if (!r.ok)       { setServerStatus('offline');    setSyncError(r.error);          setIsSyncing(false); return r; }
    setServerStatus('online');
    const ts = Date.now(); setLastSyncAt(ts); localStorage.setItem('gigbook_last_sync', String(ts));
    setIsSyncing(false);
    return { ok: true };
  }, [songs, setlists, settings, isSyncing]);

  // Bidirectional sync: pull → merge (last-edit-wins) → push merged back
  const syncBidirectional = useCallback(async () => {
    if (!apiRef.current || isSyncing) return { ok: false, error: 'not_ready' };
    setIsSyncing(true); setSyncError(null); setSyncConflicts([]);

    const pullR = await apiRef.current.syncPull();
    if (pullR.needsAuth) { setServerStatus('auth_error'); setSyncError('no_autorizado'); setIsSyncing(false); return pullR; }
    if (!pullR.ok)       { setServerStatus('offline');    setSyncError(pullR.error);     setIsSyncing(false); return pullR; }

    const { songs: rs, setlists: rl, settings: rset } = pullR.data;

    // Merge local + remote (last edit wins)
    const mergedSongs    = mergeByTimestamp(songs,    rs || []);
    const mergedSetlists = mergeByTimestamp(setlists, rl || []);

    // Collect conflicts for display
    const conflicts = [];
    for (const remote of (rs || [])) {
      const local = songs.find(s => s.id === remote.id);
      if (local && local.updatedAt && remote.updatedAt && local.updatedAt !== remote.updatedAt) {
        conflicts.push({
          id:     remote.id,
          name:   remote.name || local.name,
          winner: remote.updatedAt >= local.updatedAt ? 'server' : 'local',
        });
      }
    }

    setSongs(mergedSongs);
    setSetlists(mergedSetlists);
    setSettings(prev => ({ ...prev, ...(rset || {}) }));
    setSyncConflicts(conflicts);

    // Push merged data back to server
    const now = Date.now();
    const pushR = await apiRef.current.syncPush({
      songs:    mergedSongs.map(s  => s.updatedAt  ? s  : { ...s,  updatedAt: now }),
      setlists: mergedSetlists.map(sl => sl.updatedAt ? sl : { ...sl, updatedAt: now }),
      settings,
    });
    if (!pushR.ok) {
      setSyncError(pushR.error);
      setIsSyncing(false);
      return { ok: false, error: pushR.error, conflicts };
    }

    setServerStatus('online');
    const ts = Date.now(); setLastSyncAt(ts); localStorage.setItem('gigbook_last_sync', String(ts));
    setIsSyncing(false);
    return { ok: true, conflicts };
  }, [songs, setlists, settings, isSyncing]);

  // Assign syncRef after syncBidirectional is defined
  useEffect(() => { syncRef.current = syncBidirectional; }, [syncBidirectional]);

  const saveSong = useCallback((song) => {
    setSongs(prev => {
      const exists = prev.find(s => s.id === song.id);
      return exists
        ? prev.map(s => s.id === song.id ? { ...song, updatedAt: Date.now() } : s)
        : [...prev, { ...song, updatedAt: Date.now() }];
    });
  }, []);

  const deleteSong = useCallback((id) => {
    setSongs(prev => prev.filter(s => s.id !== id));
    setSetlists(prev => prev.map(sl => ({ ...sl, songs: sl.songs.filter(s => s !== id) })));
  }, []);

  const createSetlist = useCallback((name) => {
    setSetlists(prev => [...prev, { id: `sl_${Date.now()}`, name, songs: [], createdAt: Date.now(), updatedAt: Date.now() }]);
  }, []);

  const updateSetlist = useCallback((sl) => {
    setSetlists(prev => prev.map(s => s.id === sl.id ? { ...sl, updatedAt: Date.now() } : s));
  }, []);

  const deleteSetlist = useCallback((id) => {
    setSetlists(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const exportData = useCallback(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ songs, setlists, settings }, null, 2)], { type: "application/json" }));
    a.download = `gigbook-backup-${Date.now()}.json`;
    a.click();
  }, [songs, setlists, settings]);

  const importData = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { songs: s, setlists: sl, settings: st } = JSON.parse(e.target.result);
        if (s)  setSongs(s);
        if (sl) setSetlists(sl);
        if (st) setSettings(st);
      } catch { alert("Error al importar el archivo."); }
    };
    reader.readAsText(file);
  }, []);

  const ctx = {
    songs, setlists, settings,
    saveSong, deleteSong, createSetlist, updateSetlist, deleteSetlist,
    updateSettings, exportData, importData,
    serverUrl, authToken, serverStatus, lastSyncAt, isSyncing, syncConflicts, syncError, syncStatus,
    setServerUrl, setAuthToken, pingServer, syncPull, syncPush, syncBidirectional,
  };

  const goStage = (setlistId, songIdx) => setStage({ setlistId, songIdx });

  // ── Debounced auto-push: persiste cambios locales al servidor ─────────────
  const autoSyncTimer = useRef(null);
  const syncPushRef = useRef(syncPush);
  useEffect(() => { syncPushRef.current = syncPush; }, [syncPush]);

  useEffect(() => {
    if (serverStatus !== 'online') return;
    if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    autoSyncTimer.current = setTimeout(() => {
      syncPushRef.current();
    }, 1500);
    return () => { if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current); };
  }, [setlists, songs, serverStatus]);

  return (
    <AppCtx.Provider value={ctx}>
      <Suspense fallback={null}>
        <FontLink />
      </Suspense>
      <div className="app" data-size={settings.fontSize || "medium"}>

        {!stage && syncStatus !== 'not_configured' && (
          <SyncIndicator status={syncStatus} className="floating" />
        )}

        {toastMsg && <div className="sync-toast">{toastMsg}</div>}

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
            {tab === "sets"     && <SetlistsScreen onOpen={id => setOpenSetlist(id)} />}
            {tab === "songs"    && <SongsScreen />}
            {tab === "settings" && <SettingsScreen />}
          </>
        )}

        {!stage && (
          <nav className={`tabs${openSetlist ? " tabs-detail" : ""}`}>
            <div className="sidebar-brand">
              <span className="sidebar-logo">GigBook</span>
              <span className="sidebar-version">v0.3</span>
            </div>
            {[
              { id: "sets",     icon: "📋", label: "Setlists"  },
              { id: "songs",    icon: "🎵", label: "Canciones" },
              { id: "settings", icon: "⚙️", label: "Ajustes"   },
            ].map(t => (
              <button key={t.id} className={`tab ${tab === t.id && !openSetlist ? "active" : ""}`}
                disabled={!!openSetlist}
                onClick={() => { setTab(t.id); setOpenSetlist(null); }}>
                <span className="tab-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
            <div className="sidebar-footer">
              <div className={`sidebar-status ${serverStatus}`}>
                <div className={`status-dot ${serverStatus === 'online' ? 'online' : serverStatus === 'offline' || serverStatus === 'auth_error' ? 'offline' : ''}`} />
                <span>{serverStatus === 'online' ? 'Servidor en línea' : serverStatus === 'offline' ? 'Sin servidor' : serverStatus === 'auth_error' ? 'Token inválido' : 'Sin configurar'}</span>
                {syncStatus !== 'not_configured' && <SyncIndicator status={syncStatus} className="sidebar-sync" />}
              </div>
            </div>
          </nav>
        )}
      </div>
    </AppCtx.Provider>
  );
}
