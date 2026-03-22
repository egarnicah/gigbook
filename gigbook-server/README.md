# 🎸 GigBook Server

Servidor local Wi-Fi para sincronizar la PWA GigBook entre tu teléfono y computadora.

## Documentación

- **[INSTRUCTIVO.md](INSTRUCTIVO.md)** - Guía paso a paso para el usuario
- **[gigbook-pwa/README.md](../gigbook-pwa/README.md)** - Documentación técnica completa

## Quick Start

```bash
cd gigbook-server
npm install
npm start
```

Abre **http://localhost:3000/setup** para ver el QR y el token.

## Estructura de datos

```
data/
├── songs.json        # canciones
├── setlists.json     # setlists
├── settings.json     # preferencias
└── token.json        # token de auth
```

Backups automáticos en `*.bak` en cada escritura.

## Opciones de entorno

```bash
PORT=4000 node server.js              # Puerto personalizado
TOKEN=mi-secreto node server.js        # Token fijo
```

## Seguridad

- Token de autenticación (Bearer)
- Rate limiting: 100 req/min por IP
- CORS restrictivo (solo red local)
- Validación de datos en todos los inputs
