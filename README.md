# BiLingo Meet 🎥🌍

Plataforma de videollamadas para intercambio de idiomas. Empareja a hablantes nativos de distintos idiomas para que practiquen conversación por video, chat de texto y herramientas colaborativas en tiempo real.

## ✨ Características

- 🎥 **Videollamadas 1:1** vía WebRTC (peer-to-peer, baja latencia)
- 💬 **Chat de texto** en tiempo real durante la sesión (Socket.IO)
- 🌐 **Emparejamiento por idioma** (nativo / aprendiendo + nivel)
- 👥 **Sistema de usuarios** con perfil, idioma nativo, idioma que aprende y nivel
- 🔐 **Autenticación** con JWT + bcrypt
- 🛡️ **Panel de administración** (gestionar usuarios, salas y reportes)
- 📊 **Historial de sesiones** y duración
- 🚨 **Sistema de reportes** para moderación

## 🏗️ Stack Técnico

- **Backend:** Node.js + Express
- **Base de datos:** MySQL 8 (driver `mysql2/promise`)
- **Realtime:** Socket.IO
- **Auth:** JWT + bcryptjs
- **Frontend:** HTML + Bootstrap 5 + Vanilla JS (SPA con router por hash)
- **Iconos:** Font Awesome 6 (CDN)

## 📁 Estructura

```
.
├── server.js                 # Entry point (Express + Socket.IO)
├── config/
│   ├── db.js                 # Pool MySQL
│   └── env.js                # Lectura de variables de entorno
├── routes/                   # Definición de rutas /api/*
├── controllers/              # Handlers HTTP (thin layer)
├── services/                 # Lógica de negocio + queries SQL
├── middleware/               # auth, errores
├── sockets/                  # Lógica Socket.IO (chat + WebRTC signaling)
├── utils/                    # hash, jwt, code
├── db/
│   ├── schema.sql            # CREATE TABLE de todo el esquema
│   └── seed-admin.js         # Script para crear/resetear el admin
└── public/
    ├── index.html            # Shell SPA
    ├── css/                  # style.css + components.css
    └── js/
        ├── api.js            # Wrapper fetch
        ├── auth.js           # Token + sesión
        ├── router.js         # Hash router
        ├── ui.js             # Toasts, modales
        ├── app.js            # Bootstrap
        └── views/            # Una vista por archivo
```

## 🚀 Instalación local

### Requisitos

- Node.js 18+ y npm
- MySQL 8+ (local o remoto)

### 1. Clona o descomprime el proyecto

```bash
cd bilingo-meet
```

### 2. Instala dependencias

```bash
npm install
```

### 3. Crea la base de datos en MySQL

```bash
mysql -u root -p -e "CREATE DATABASE bilingo_meet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 4. Importa el esquema y los datos

Si tienes el archivo `bilingo-meet-dump.sql` (incluido en la exportación):

```bash
mysql -u root -p bilingo_meet < bilingo-meet-dump.sql
```

O alternativamente, importa solo el esquema desde `db/schema.sql`:

```bash
mysql -u root -p bilingo_meet < db/schema.sql
```

### 5. Configura las variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Puerto HTTP en el que escuchará el servidor
PORT=3000

# Base de datos MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=bilingo_meet

# Secret para firmar JWT (cámbialo por algo largo y aleatorio)
JWT_SECRET=cambia-esto-por-un-secret-largo-y-aleatorio

# Base path (déjalo vacío para correr en localhost)
BASE_PATH=
```

> ⚠️ **Importante:** el código NO usa fallbacks como `process.env.PORT || 3000` — si una variable falta, el servidor fallará al arrancar. Esto es intencional para detectar configuraciones incorrectas.

### 6. Crea el usuario admin

```bash
node db/seed-admin.js
```

Esto crea o resetea el usuario:
- **Email:** `admin@bilingo.com`
- **Password:** `admin1234`

### 7. Arranca el servidor

```bash
node server.js
```

Verás en consola:
```
✅ Server listening on port 3000
```

### 8. Abre la app

Navega a [http://localhost:3000](http://localhost:3000)

## 👤 Cuentas de prueba

Después del seed inicial tienes:

| Email                | Password    | Rol   |
|----------------------|-------------|-------|
| `admin@bilingo.com`  | `admin1234` | admin |

Regístrate con tu propio email para probar el flujo de usuario normal.

## 🔌 Endpoints principales

### Auth
- `POST /api/auth/register` — crear cuenta
- `POST /api/auth/login` — iniciar sesión (devuelve JWT)
- `GET  /api/auth/me` — perfil del usuario actual

### Usuarios
- `GET  /api/users/me` — mi perfil
- `PUT  /api/users/me` — actualizar perfil
- `GET  /api/users/partners` — encontrar partners de intercambio

### Salas
- `POST /api/rooms` — crear sala
- `GET  /api/rooms/:code` — info de una sala
- `POST /api/rooms/:code/join` — unirse a una sala
- `POST /api/rooms/:code/leave` — salir de una sala

### Admin (requiere rol admin)
- `GET    /api/admin/users` — listar usuarios
- `PUT    /api/admin/users/:id` — editar usuario
- `DELETE /api/admin/users/:id` — eliminar usuario
- `GET    /api/admin/rooms` — listar salas
- `GET    /api/admin/reports` — listar reportes

## 🔄 Socket.IO

Eventos en `/socket.io`:

**Cliente → Servidor**
- `room:join` `{ roomCode, token }`
- `room:leave`
- `chat:message` `{ text }`
- `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate`

**Servidor → Cliente**
- `room:user-joined` / `room:user-left`
- `chat:message`
- `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate`

## 🐛 Troubleshooting

**`ECONNREFUSED` al arrancar**
→ Revisa que MySQL esté corriendo y las credenciales en `.env` sean correctas.

**`Unknown column 'X' in 'where clause'`**
→ El esquema no se importó completo. Reimporta `db/schema.sql` o el dump.

**WebSocket no conecta**
→ Si corres detrás de un proxy (nginx, Cloudflare), asegúrate de que permita el `Upgrade: websocket`. En localhost no debería fallar.

**No puedo ver mi cámara**
→ WebRTC requiere `https://` o `localhost`. Si corres en una IP de LAN tendrás que generar un certificado SSL local.

## 📜 Licencia

Uso personal / educativo.

## 👏 Créditos

Construido en ThinkTogether con asistencia de IA.
