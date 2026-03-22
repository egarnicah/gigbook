# 🎸 GigBook - Guía del Usuario

GigBook es tu setlist digital para el escenario. Gestiona tus canciones, organízalas en setlists y llévalas contigo sin necesidad de internet.

---

## Primeros Pasos

### 1. Configurar el Servidor (Computadora)

El servidor permite sincronizar tus datos entre dispositivos.

```bash
# En tu computadora
cd gigbook-server
npm install
npm start
```

Verás algo como esto:

```
  🎸  GigBook Server v0.2
  ─────────────────────────────────────
  Local:    http://localhost:3000
  Red:      http://192.168.1.100:3000
  Setup:    http://192.168.1.100:3000/setup
  Token:    a1b2c3d4e5f6...
  ─────────────────────────────────────
```

**Importante:** Anota la dirección IP (ej: `192.168.1.100`) y el token.

### 2. Acceder al Setup

Abre en tu navegador: `http://192.168.1.100:3000/setup`

Verás:
- Un código QR
- La URL de conexión
- Tu token de seguridad

### 3. Conectar la App

1. En tu teléfono, abre GigBook
2. Ve a **Ajustes** (pestaña inferior)
3. En "Servidor Wi-Fi", ingresa la URL o escanea el QR
4. Pega el token que aparece en /setup
5. Presiona **Obtener** o **Enviar**

---

## Usar GigBook

### Navegación

La app tiene 3 pestañas principales:

| Pestaña | Función |
|---------|---------|
| 📋 Setlists | Ver y gestionar tus setlists |
| 🎵 Canciones | Biblioteca completa de canciones |
| ⚙️ Ajustes | Configuración y sincronización |

### Crear una Canción

1. Ve a **Canciones**
2. Toca el botón **+** (abajo a la derecha)
3. Completa:
   - **Nombre**: Título de la canción
   - **BPM**: Velocidad en beats por minuto (opcional)
   - **Tonalidad**: Ej: Am, C, G (opcional)
   - **Letra y acordes**: El contenido de la canción

### Escribir Letras con Acordes

GigBook entiende un formato especial:

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

**Reglas:**
- Usa `[Nombre]` para secciones (Intro, Verso, Coro, etc.)
- Escribe acordes en línea propia sobre la letra
- O incluye acordes inline: `[Am]tu nombre`
- Líneas vacías separan bloques

### Crear un Setlist

1. Ve a **Setlists**
2. Toca el botón **+**
3. Dale un nombre (ej: "Concierto Viernes")
4. Toca **Crear**

### Agregar Canciones a un Setlist

1. Abre un setlist tocándolo
2. En "Agregar canción", toca las canciones que quieras
3. Reordena tocando y arrastrando (próximamente)

### Eliminar una Canción de un Setlist

Toca el botón **✕** junto a la canción.

---

## Modo Escenario

El modo escenario muestra una canción gigante optimizada para leer en el escenario.

### Entrar al Escenario

Desde un setlist, toca **▶ ESCENARIO** o el botón **▶** junto a cualquier canción.

### Controles Táctiles

| Gesto | Acción |
|-------|--------|
| **Tap** | Mostrar/ocultar controles |
| **Swipe izquierda** | Siguiente canción |
| **Swipe derecha** | Canción anterior |
| **Doble tap** | Play/pausa auto-scroll |
| **Long press (700ms)** | Bloquear pantalla |

### Configurar el Escenario

En **Ajustes → Escenario**:

- **Tamaño de fuente**: Pequeño, Mediano, Grande
- **Auto-ocultar controles**: Los controles desaparecen tras 3.5 segundos

### Auto-Scroll

Usa el control de **BPM** para ajustar la velocidad del scroll automático:

1. Ponlo a **0** para scroll manual
2. Ajusta el BPM para que coincida con el tempo de la canción

---

## Sincronización

### Cómo Funciona

La sincronización mezcla los datos de tu teléfono con los del servidor:
- **Obtener**: Descarga datos del servidor a tu teléfono
- **Enviar**: Sube datos de tu teléfono al servidor

### Resolver Conflictos

Si modificaste la misma canción en ambos dispositivos, GigBook elige automáticamente:
- **Servidor**: Si se editó primero en la compu
- **Cliente**: Si se editó primero en el teléfono

Verás una lista de conflictos resueltos después de sincronizar.

### Sin Internet

GigBook funciona **100% offline**. Todos tus datos se guardan localmente.

La sincronización solo es necesaria para:
- Compartir datos entre dispositivos
- Hacer backup en la compu
- Editar canciones desde la computadora

---

## Backup y Restauración

### Exportar Datos

1. Ve a **Ajustes**
2. Toca **Exportar JSON**
3. Se descargará un archivo `gigbook-backup-XXXXXX.json`

### Importar Datos

1. Ve a **Ajustes**
2. Toca **Importar**
3. Selecciona tu archivo `.json`

**Nota:** Esto reemplaza todos los datos actuales.

---

## Preguntas Frecuentes

### ¿Puedo usar GigBook sin servidor?
**Sí.** La app funciona completamente offline. Solo necesitas el servidor para sincronizar entre dispositivos.

### ¿Mis datos están seguros?
Tus datos se guardan:
1. En tu teléfono (localStorage)
2. En la computadora (si usas servidor)

No se envían a ningún servicio externo.

### ¿Puedo editar desde la computadora?
Actualmente no hay interfaz web. Usa el servidor para sincronizar datos ya creados en la app.

### ¿Funciona en iPhone?
Sí, pero:
- El escaneo de QR no funciona en Safari
- Usa el campo manual para ingresar la URL
- Puede pedirtele "Instalar app" (no soportado aún)

### ¿Qué pasa si reinicio el servidor?
El token y los datos se mantienen en `data/`. Puedes reiniciar sin perder nada.

### ¿Puedo cambiar el puerto?
Sí:
```bash
PORT=4000 npm start
```

---

## Solución de Problemas

### "Servidor no disponible"
1. Verifica que el servidor esté corriendo
2. Verifica que estés en la misma red Wi-Fi
3. Comprueba la URL (debe ser `http://192.168...` no `https://`)

### "Token inválido"
1. Copia el token exacto de `/setup`
2. No incluyas espacios extra

### La app está lenta
1. Cierra otras apps
2. Reduce el tamaño de fuente en escenario
3. Desactiva auto-scroll

### No puedo ver el QR
El QR usa una biblioteca externa. Si no carga:
1. Copia la URL manualmente
2. O verifica tu conexión a internet (solo para ver el QR)

---

## Referencia Rápida

### Atajos de Teclado (si usas navegador)
| Tecla | Acción |
|-------|--------|
| `1, 2, 3` | Cambiar pestaña |
| `n` | Nueva canción/setlist |
| `s` | Sync |
| `e` | Exportar |

### Formato de Acordes Soportados

| Tipo | Ejemplo |
|------|---------|
| Mayor | `C`, `G`, `D` |
| Menor | `Am`, `Em`, `Bm` |
| Séptima | `G7`, `Cmaj7` |
| Suspendido | `Dsus4`, `Asus2` |
| Disminuido | `Bdim` |
| Aumentado | `Caug` |
| Con bajo | `Am/G`, `C/E` |

---

¿Dudas? Revisa la documentación técnica en `gigbook-pwa/README.md`
