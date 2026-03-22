# GigBook PWA - Documentación Técnica

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        Teléfono (Cliente)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    React PWA                          │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────────┐ │   │
│  │  │ App.jsx │  │ Context  │  │  Service Worker    │ │   │
│  │  │         │──│ (Estado) │  │  (Cache First)    │ │   │
│  │  └─────────┘  └──────────┘  └────────────────────┘ │   │
│  │       │                           │                  │   │
│  │       └───────────┬───────────────┘                  │   │
│  │                   │                                  │   │
│  │            ┌─────▼─────┐                            │   │
│  │            │ localStorage │                          │   │
│  │            │ (Persistencia) │                        │   │
│  │            └─────────────┘                           │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────┬──────────────────────────────┘
                             │ Wi-Fi
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Computadora (Servidor)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Express.js                          │   │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │   │
│  │  │ /api/sync  │  │ /api/ping  │  │ /setup (QR)  │  │   │
│  │  └─────┬──────┘  └─────┬──────┘  └───────────────┘  │   │
│  │        │                │                            │   │
│  │        └────────┬───────┘                            │   │
│  │                 ▼                                    │   │
│  │         ┌──────────────┐                            │   │
│  │         │  Merge Logic │                            │   │
│  │         └──────┬───────┘                            │   │
│  │                ▼                                    │   │
│  │         ┌──────────────┐                            │   │
│  │         │  data/*.json │  (escritura atómica)       │   │
│  │         └──────────────┘                            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Modelo de Datos

### Song (Canción)
```typescript
interface Song {
  id: string;           // UUID generado: "s_1678901234567"
  name: string;         // "La Noche Que Te Fuiste"
  bpm: number;          // 78
  key: string;          // "Am"
  content: string;      // Letra con acordes en formato especial
  updatedAt: number;    // Timestamp Unix
}
```

### Setlist
```typescript
interface Setlist {
  id: string;           // "sl_1678901234567"
  name: string;         // "Concierto Viernes"
  songs: string[];       // Array de IDs: ["s1", "s2", "s3"]
  createdAt: number;
  updatedAt: number;
}
```

### Settings
```typescript
interface Settings {
  fontSize: "small" | "medium" | "large";
  autoHide: boolean;     // Auto-ocultar controles en escenario
}
```

## Formato de Contenido

Las canciones usan un formato de texto simple con secciones y acordes:

```
[Intro]
Am  F  C  G

[Verso 1]
Am              F
Caminé por la orilla
        C            G
buscando tu silencio

[Coro]
Am    F     C      G
La noche que te fuiste
```

### Reglas:
- `[Nombre]` - Define una sección (Intro, Verso, Coro, etc.)
- Acordes en línea propia - Se muestran encima de la letra siguiente
- `[Am]` - Acorde inline dentro de la letra
- Líneas vacías - Separan bloques visually

## API del Servidor

### Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/ping` | No | Health check, retorna estado del servidor |
| GET | `/api/verify` | Sí | Verifica si el token es válido |
| GET | `/api/sync` | Sí | Obtiene snapshot completo |
| POST | `/api/sync` | Sí | Envía datos y hace merge |
| GET | `/api/songs` | Sí | Lista todas las canciones |
| POST | `/api/songs/:id` | Sí | Crear/actualizar canción |
| DELETE | `/api/songs/:id` | Sí | Eliminar canción |
| GET | `/api/setlists` | Sí | Lista todos los setlists |
| POST | `/api/setlists/:id` | Sí | Crear/actualizar setlist |
| DELETE | `/api/setlists/:id` | Sí | Eliminar setlist |
| GET | `/setup` | No | Página con QR e instrucciones |

### Autenticación

Todas las rutas protegidas requieren header:
```
Authorization: Bearer <token>
```

El token se genera automáticamente en `data/token.json` y se muestra en `/setup`.

### Sync (Merge Strategy)

```javascript
// Para cada registro:
// 1. Si existe solo en cliente → agregar al servidor
// 2. Si existe solo en servidor → mantener
// 3. Si existe en ambos → gana el updatedAt más reciente
// 4. En empate exacto → gana el servidor
```

### Detección de Conflictos

Cuando ambos lados modificaron el mismo registro entre syncs:
```json
{
  "ok": true,
  "conflicts": [
    { "type": "song", "id": "s1", "name": "Mi Canción", "winner": "server" }
  ]
}
```

## Service Worker

### Estrategias de Cache

| Recurso | Estrategia |
|---------|------------|
| Assets (JS, CSS, HTML) | Cache First → Network Fallback |
| API calls | Network Only |
| Fonts | Browser default |

### Versionado

El SW usa versionado por prefijo: `gigbook-v1`, `gigbook-v2`, etc.

Al detectar nueva versión:
1. Instala el nuevo SW en segundo plano
2. Muestra banner de actualización
3. El usuario decide cuándo recargar

## Persistencia Local

### localStorage Keys

| Key | Contenido |
|-----|-----------|
| `gigbook_data` | `{ songs: [], setlists: [] }` |
| `gigbook_settings` | `{ fontSize, autoHide }` |
| `gigbook_server_url` | URL del servidor |
| `gigbook_token` | Token de autenticación |
| `gigbook_last_sync` | Timestamp último sync |

### Boot Sequence

1. Cargar datos de localStorage
2. Si está vacío → cargar SAMPLE_DATA (demo)
3. Verificar si hay conexión al servidor
4. Si hay → intentar ping automático

## Seguridad Implementada

### Servidor
- [x] CORS restrictivo (solo red local /24)
- [x] Token Bearer authentication
- [x] Rate limiting (100 req/min por IP)
- [x] Validación de schema en todos los inputs
- [x] Payload limit (1MB)
- [x] Escritura atómica de archivos (previene corrupción)

### Cliente
- [x] Timeouts en todas las peticiones (5s)
- [x] Manejo de errores de red
- [x] Sin datos sensibles hardcodeados

## Componentes React

### Jerarquía
```
App
├── StageScreen (modo escenario)
├── SetlistScreen (detalle de setlist)
│   └── SongEditor
├── SetlistsScreen (lista de setlists)
│   └── Modal (crear setlist)
├── SongsScreen (biblioteca)
│   └── SongEditor
├── SettingsScreen
│   └── QRScanner
└── BottomTabs
```

### Context API

```javascript
const AppCtx = {
  // Estado
  songs, setlists, settings,
  serverUrl, serverStatus, authToken,
  
  // Acciones
  saveSong, deleteSong,
  createSetlist, updateSetlist, deleteSetlist,
  updateSettings,
  exportData, importData,
  
  // Sync
  setServerUrl, setAuthToken,
  pingServer, syncPull, syncPush
}
```

## Performance

### Optimizaciones Aplicadas

1. **React.memo** - Todos los componentes screen están memoizados
2. **useMemo** - Filtrado de canciones
3. **CSS externo** - No inline styles recalculados
4. **Lazy loading fonts** - Con Suspense
5. **Code splitting** - Vendor chunk separado
6. **Sourcemaps off** - En producción

### Métricas Objetivo

- First Contentful Paint: < 1s
- Time to Interactive: < 2s
- Bundle size: < 150KB gzipped

## Deploy

### Build PWA
```bash
cd gigbook-pwa
npm run build:full
```

Output en `gigbook-pwa/dist/`

### Copiar a servidor
```bash
cp -r dist ../gigbook-server/client
```

El servidor sirve automáticamente desde `/client` si existe.

## Troubleshooting

### El QR no se escanea
- Verificar que ambos dispositivos estén en la misma red
- Probar manualmente copiando la URL

### Sync falla constantemente
- Verificar el token sea correcto
- Revisar consola del navegador (F12)
- Verificar que el servidor esté corriendo

### PWA no instala
- Chrome required en Android
- Safari en iOS tiene limitaciones

### Datos perdidos
- Exportar backup regularmente desde Ajustes
- El servidor mantiene backups en `data/*.bak`
