# 🌱 Planta-Emporio

Espacio de trabajo privado de la empresa: **proyectos y tareas, documentos, chat, reuniones y decisiones,
objetivos, archivos y finanzas**, todo conectado y en un solo lugar.

- Interfaz minimalista en español, con tema claro y oscuro, para computadora, tableta y teléfono.
- Un solo servidor (Node.js + SQLite). No requiere servicios de pago ni bases de datos externas.
- Permisos por rol validados en el servidor; nada privado se ve solo por conocer una URL.
- Los cambios llegan en tiempo real a los demás integrantes.

📄 [Arquitectura](docs/ARQUITECTURA.md) · 📋 [Informe del proyecto](docs/INFORME.md)

## Requisitos

- Node.js **22.13 o superior** (usa el módulo integrado `node:sqlite`).

## Probarlo en tu computadora

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>. La primera vez la aplicación pide el nombre de la empresa y crea la cuenta de
administración. Después, en **Integrantes → Invitar**, genera un enlace para cada socio.

Los datos se guardan en la carpeta `data/` (base de datos, archivos subidos y respaldos). Está excluida de Git.

## Producción (servidor propio)

```bash
npm install
npm run build
PUBLIC_URL=https://tu-dominio.com npm start      # escucha en el puerto 3000
```

O con Docker:

```bash
docker build -t planta-emporio .
docker run -d -p 3000:3000 -v planta-data:/data -e PUBLIC_URL=https://tu-dominio.com planta-emporio
```

Debe publicarse **detrás de HTTPS** (por ejemplo con Caddy o el proxy del proveedor): las cookies de sesión
se marcan como seguras en producción. Variables disponibles en [`.env.example`](.env.example).

> Elegir dónde alojarlo (un VPS pequeño, Railway, Fly.io, Render, un equipo propio…) implica un costo mensual
> y un dominio. Esa decisión queda pendiente de tu aprobación; ver el informe.

### Correo (opcional)

Sin SMTP la plataforma funciona completa: las invitaciones y la recuperación de contraseña se comparten con un
enlace que genera un administrador, y las notificaciones son dentro de la aplicación. Nunca se simula un envío.
Para enviar correos, configura `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`.

## Respaldos

- Cada día se crea automáticamente una copia de la base de datos en `data/backups` (se conservan 14).
- En **Configuración → Respaldos** un administrador puede crear y descargar copias.
- Para restaurar: detén el servidor, reemplaza `data/planta.db` por la copia y vuelve a iniciarlo.
- Respalda también la carpeta `data/uploads` (archivos subidos).

## Pruebas

```bash
npm test           # 40 pruebas de integración de la API (base de datos temporal)
npm run test:e2e   # 13 recorridos en navegador con Playwright (incluye móvil)
```

## Estructura

```
server/          API Express, esquema SQLite, permisos, tareas programadas
client/src/      aplicación React (componentes, módulos, estilos)
tests/api/       pruebas de integración (node:test)
tests/e2e/       recorridos de usuario (Playwright)
docs/            arquitectura e informe
```
