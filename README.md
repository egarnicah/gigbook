# GigBook
PWA para músicos - Gestor de setlists con modo escenario y sincronización Wi-Fi.

## Ejecutable de Escritorio (Escenario / Servidor)
Usa **GigBook-Server-v0.5.exe** para iniciar el servidor y la aplicación en tu PC.
1. Haz doble clic en `GigBook-Server-v0.5.exe`.
2. Escanea el código QR que aparecerá para conectar tu iPhone/Android.
3. El servidor guardará tus canciones en la carpeta `./data/`.

## Estructura del Proyecto
```
gigbook/
├── gigbook-pwa/      # Aplicación React (PWA) - Fuente
├── gigbook-server/   # Servidor Node.js (API) - Fuente
├── gigbook-desktop/  # Fuente del ejecutable standalone
└── data/             # Carpeta de persistencia (creada al iniciar)
```

Ver [gigbook-server/INSTRUCTIVO.md](gigbook-server/INSTRUCTIVO.md) para instrucciones detalladas.
