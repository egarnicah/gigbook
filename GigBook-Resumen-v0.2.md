# 🎸 GigBook PWA

## Offline-First para Músicos en Vivo

**Resumen detallado del proyecto — Arquitectura, funcionalidad y flujo de uso**

---

# 1. Qué es GigBook

GigBook es una aplicación web progresiva (PWA) diseñada específicamente para músicos que tocan en vivo. Permite gestionar canciones, setlists, letras con acordes y auto-scroll en escena, todo desde el teléfono y sin depender de internet.

La aplicación funciona en dos modos claramente separados:

- **Modo edición** — para preparar canciones y setlists en casa o el estudio
- **Modo escenario** — pantalla negra, texto blanco, auto-scroll basado en BPM, sin distracciones

## Principios de diseño

- **Offline-first:** funciona 100% sin internet una vez instalada
- **Sin login ni cuentas:** todos los datos son locales
- **Una mano libre:** gestos para todo en el escenario
- **Instalable:** se comporta como app nativa en iOS y Android
- **Seguro:** autenticación por token y sincronización cifrada en red local

---

# 2. Stack Tecnológico

| Tecnologia | Rol |
|------------|-----|
| React 18 | UI — componentes, hooks, Context API |
| Vite 5 | Build tool — dev server con HMR, build optimizado |
| React Context | Estado global — canciones, setlists, preferencias, sync |
| LocalStorage | Persistencia ligera — URL servidor, token, ultimo sync, preferencias |
| Service Worker | Cache offline-first — assets JS/CSS/HTML |
| manifest.json | Metadatos PWA — nombre, iconos, modo standalone |
| Express (Node.js) | Servidor local Wi-Fi para sincronizacion |
| JSON files | Almacenamiento del servidor — songs.json, setlists.json, token.json |

---

# 3. Arquitectura del Sistema

## 3.1 Dos entornos, una sola app

La misma base de codigo corre en dos contextos:

- **Telefono (PWA instalada)** — interfaz vertical, gestos, modo escenario
- **Computadora (navegador)** — misma app, layout adaptado para pantalla grande, teclado completo

## 3.2 Estructura de archivos

```
gigbook/
├── gigbook-pwa/                  <- frontend
│   ├── src/
│   │   ├── App.jsx              <- toda la logica de la PWA
│   │   ├── main.jsx             <- entry point React
│   │   ├── styles.css           <- estilos externos
│   │   └── components/
│   │       └── FontLink.jsx     <- lazy loading fonts
│   ├── index.html               <- shell PWA, registro SW
│   ├── manifest.json            <- metadatos PWA
│   ├── service-worker.js        <- cache offline v2
│   ├── vite.config.js           <- proxy /api en desarrollo
│   ├── generate-icons.mjs       <- genera iconos 192/512px
│   ├── package.json
│   └── README.md                <- documentacion tecnica
│
└── gigbook-server/               <- backend Node.js
    ├── server.js                 <- Express + merge + QR + auth
    ├── package.json
    ├── README.md                 <- indice rapido
    ├── INSTRUCTIVO.md            <- guia detallada para usuarios
    └── data/                    <- creado automaticamente
        ├── songs.json
        ├── setlists.json
        ├── settings.json
        └── token.json
```

## 3.3 Modelo de datos

| Entidad | Campos |
|---------|--------|
| Song | id, name, bpm, key, content, updatedAt |
| Setlist | id, name, songs[ ], createdAt, updatedAt |
| Settings | fontSize, autoHide |

---

# 4. Pantallas y Flujo de la App

## 4.1 Setlists

Pantalla principal al abrir la app. Muestra todos los setlists con:

- Nombre del setlist y numero de canciones
- Indicador de setlist activo (estrella)
- Acciones: abrir, activar, eliminar
- Boton + para crear nuevo setlist

## 4.2 Detalle del Setlist

Al abrir un setlist se muestra la lista de canciones en orden con:

- Numero de posicion, nombre, tonalidad y BPM
- Boton de play individual por cancion para entrar al escenario en esa posicion
- Agregar canciones de la biblioteca o crear nuevas
- Quitar canciones del setlist sin eliminarlas de la biblioteca
- Boton ESCENARIO — entra al modo escenario desde la primera cancion

## 4.3 Biblioteca de Canciones

Catalogo global independiente de los setlists:

- Busqueda combinada por nombre, letra y acordes
- Crear, editar y eliminar canciones
- Visualizacion de BPM y tonalidad en la lista

## 4.4 Editor de Canciones

Campos: nombre, BPM, tonalidad y contenido libre en textarea con soporte para:

- Secciones: [Intro], [Verso], [Coro], [Bridge], etc.
- Acordes en linea propia: Am  F  C  G
- Acordes inline dentro de la letra: [Am]tu nombre

## 4.5 Ajustes

Tres secciones: Servidor Wi-Fi, Escenario y Datos locales.

### Servidor Wi-Fi

- Campo de URL del servidor
- Boton de camara para escanear QR
- Campo para ingresar token de autenticacion
- Indicador de estado (online/offline/auth_error)
- Botones Obtener y Enviar
- Historial de sincronizacion
- Lista de conflictos resueltos

### Escenario

- Tamano de fuente (pequeno/mediano/grande)
- Auto-ocultar controles

### Datos

- Exportar e importar backup JSON completo

---

# 5. Modo Escenario

El modo escenario es la funcion principal en vivo. Ocupa toda la pantalla con fondo negro y texto blanco, optimizado para leer desde distancia.

## 5.1 Auto-scroll

- Velocidad calculada en base al BPM de la cancion
- Slider en los controles para ajustar velocidad en tiempo real sin detener el scroll
- Play/pause del auto-scroll en cualquier momento
- Al cambiar de cancion, el scroll regresa al inicio automaticamente

## 5.2 Gestos tactiles

| Gesto | Accion |
|-------|--------|
| Tap simple | Mostrar / ocultar controles |
| Doble tap | Play / pause del auto-scroll |
| Swipe horizontal | Cambiar a la cancion anterior o siguiente |
| Swipe vertical | Scroll manual (la cancion sigue donde quedaste) |
| Mantener presionado 700ms | Bloquear / desbloquear controles |

## 5.3 Controles visibles

- **Barra superior:** boton Salir y contador de posicion (ej. 3 / 8)
- **Barra inferior:** botones Anterior / Siguiente, boton Play-Pause, slider de BPM
- Los controles se ocultan solos a los 3.5 segundos (configurable)
- Indicador visible si los controles estan bloqueados

## 5.4 Parser de acordes

El contenido de cada cancion se parsea automaticamente al entrar al modo escenario:

- Secciones [Coro], [Verso], etc. — etiqueta en naranja encima del bloque
- Lineas de solo acordes (Am  F  C  G) — texto en amarillo, tamano reducido
- Acordes inline [Am] — superindice amarillo junto a la letra
- Lineas de letra — texto blanco al tamano configurado

---

# 6. Sincronizacion Wi-Fi

El sistema de sincronizacion permite editar canciones con teclado completo en la computadora y transferirlas al telefono sin cables ni internet, usando la red Wi-Fi local de casa.

## 6.1 Como funciona

1. Se levanta el servidor Node.js en la computadora: `npm start`
2. El servidor detecta automaticamente la IP local Wi-Fi
3. Se accede a http://IP:3000/setup para ver el codigo QR y el token
4. Se escanea el QR con el telefono desde la app (seccion Ajustes)
5. Se ingresa el token de sincronizacion
6. La app hace un ping para verificar conexion y muestra el estado
7. Se usan los botones Obtener (baja datos del servidor) o Enviar (sube datos al servidor)

## 6.2 Merge por timestamp

Cuando hay cambios en ambos lados, el sistema resuelve conflictos automaticamente comparando el campo updatedAt de cada registro:

- Gana el registro modificado mas recientemente
- En empate exacto, gana el servidor
- Si una cancion solo existe en un lado, se agrega al otro
- La app muestra una lista detallada de que canciones tuvieron conflicto y quien gano

## 6.3 Escritura atomica en el servidor

Para evitar corrupcion de archivos si el proceso se interrumpe:

1. El servidor copia el archivo actual a .bak antes de cada escritura
2. Escribe los nuevos datos en un archivo .tmp
3. Renombra .tmp al archivo real (operacion atomica del sistema operativo)
4. Si algo falla, el archivo .bak permite recuperacion manual

## 6.4 Seguridad implementada

### Autenticacion por Token

- Token generado automaticamente al primer inicio del servidor
- Almacenado en data/token.json
- Mostrado en la pagina /setup para copiar facilmente
- Requerido en todas las API calls (excepto /api/ping y /setup)

### Rate Limiting

- 100 requests por minuto por IP
- Previene ataques de fuerza bruta

### CORS Restrictivo

- Solo permite conexiones desde la red local (/24)
- Bloquea requests externos automaticamente

### Validacion de Schema

- Todos los inputs son validados antes de procesar
- Canciones: id, name, bpm validos
- Setlists: id, name, songs array
- Settings: solo campos permitidos (fontSize, autoHide)

## 6.5 Disponibilidad

- El servidor solo corre cuando tu lo arrancas manualmente
- Si el servidor no esta disponible, la app funciona normalmente en modo offline
- La app detecta el estado del servidor al abrir (online / offline / sin configurar / auth_error)

---

# 7. PWA — Instalacion y Offline

## 7.1 Instalacion en el telefono

| Sistema | Como instalar |
|---------|---------------|
| iOS (Safari) | Boton compartir -> Agregar a pantalla de inicio |
| Android (Chrome) | Menu tres puntos -> Instalar aplicacion |

## 7.2 Service Worker — estrategia de cache

| Recurso | Estrategia |
|---------|------------|
| Assets (JS, CSS, HTML) | Cache First -> Network Fallback |
| API calls | Network Only |
| Fonts | Browser default |

### Versionado del SW

El SW usa versionado: `gigbook-v1`, `gigbook-v2`, etc.

Al detectar nueva version:
1. Instala el nuevo SW en segundo plano
2. Muestra banner de actualizacion
3. El usuario decide cuando recargar (nunca en medio de un show)

## 7.3 Splash screen

Mientras React carga se muestra una pantalla negra con el logo de GigBook. Desaparece con una transicion suave al montar la app.

---

# 8. Backup y Portabilidad

Sin dependencias de cloud, toda la seguridad de los datos depende de ti. El sistema lo hace facil:

- **Exportar JSON** — un solo archivo con todas las canciones, setlists y preferencias
- **Importar JSON** — restaura desde cualquier backup exportado previamente
- **Servidor como fuente de verdad** — los datos en data/songs.json y data/setlists.json son texto plano
- **Backups automaticos del servidor** — cada escritura genera un .bak del estado anterior

---

# 9. Comandos para Levantar el Proyecto

## Primera vez

```bash
# 1. Servidor
cd gigbook-server
npm install
npm start

# 2. PWA (otra terminal)
cd gigbook-pwa
npm install
npm run icons
npm run dev
```

## Uso diario (antes del ensayo)

```bash
cd gigbook-server && npm start

# Abre http://localhost:3000/setup en tu compu
# Escanea el QR con el telefono desde Ajustes
# Copia el token desde /setup
# Edita canciones en la compu
# En el telefono: Ajustes -> Obtener

# Ctrl+C para apagar el servidor
```

## Build para produccion

```bash
cd gigbook-pwa
npm run build

cp -r dist ../gigbook-server/client/

# Ahora http://192.168.1.X:3000 sirve la PWA completa
```

## Opciones del servidor

```bash
PORT=4000 node server.js          # Puerto personalizado
TOKEN=mi-secreto node server.js   # Token fijo
```

---

# 10. Estado Actual

## Implementado en v0.2

| Modulo | Estado |
|--------|--------|
| App.jsx — UI completa | ✅ Listo |
| Setlists — CRUD completo | ✅ Listo |
| Canciones — CRUD + busqueda | ✅ Listo |
| Editor de canciones | ✅ Listo |
| Modo escenario + gestos | ✅ Listo |
| Parser de acordes y secciones | ✅ Listo |
| Auto-scroll por BPM | ✅ Listo |
| Ajustes — fuente, auto-ocultar | ✅ Listo |
| Export / Import JSON | ✅ Listo |
| server.js — Express + merge | ✅ Listo |
| Escritura atomica + .bak | ✅ Listo |
| QR en /setup | ✅ Listo |
| API REST /api/sync, /api/songs... | ✅ Listo |
| Sync UI — Obtener, Enviar, conflictos | ✅ Listo |
| QR Scanner en la app | ✅ Listo |
| manifest.json | ✅ Listo |
| service-worker.js v2 | ✅ Listo |
| index.html + splash + update banner | ✅ Listo |
| vite.config.js | ✅ Listo |
| generate-icons.mjs | ✅ Listo |
| Token de autenticacion | ✅ Listo |
| Rate limiting | ✅ Listo |
| CORS restrictivo | ✅ Listo |
| Validacion de schema | ✅ Listo |
| Documentacion tecnica | ✅ Listo |
| Instructivo para usuarios | ✅ Listo |

## Pendiente (fases futuras)

| Feature | Prioridad |
|---------|-----------|
| IndexedDB (persistencia real en telefono) | Alta |
| Reordenar canciones con drag & drop | Media |
| Layout de dos columnas en computadora | Media |
| Atajos de teclado en modo escritorio | Media |
| Notas por seccion en el editor | Baja |
| Tags y categorias en canciones | Baja |

---

# Resultado esperado

Una app que se siente nativa en iOS y Android.

- Funciona 100% offline en el escenario
- Edicion comoda con teclado en la computadora
- Sincronizacion en segundos via Wi-Fi antes del show
- Sin pagos de desarrollador, sin cuentas, sin internet requerido
- Seguro con autenticacion por token

---

**GigBook v0.2** — Proyecto en desarrollo activo

Repositorio: https://github.com/egarnicah/gigbook
