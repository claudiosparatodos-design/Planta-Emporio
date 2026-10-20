# Planta-Emporio — Arquitectura

## Principios

1. **Un solo servidor, sin servicios de pago.** Node.js + SQLite en un archivo (`data/planta.db`).
   Se puede alojar en cualquier VPS o equipo propio. No hay dependencias de terceros obligatorias.
2. **El servidor es la fuente de verdad.** Toda la información empresarial vive en la base de datos.
   El navegador solo guarda preferencias cosméticas (p. ej. el tema mientras carga).
3. **Permisos en el servidor.** Cada endpoint valida sesión y permisos; la interfaz solo oculta lo que el
   servidor ya prohíbe.
4. **Nada se pierde en silencio.** Proyectos, tareas, páginas y archivos van a una papelera recuperable.
   Los movimientos financieros no se borran: se **anulan** con motivo. Todo cambio relevante queda en el
   historial de actividad (quién, qué, cuándo, antes/después).
5. **Una sola fuente por dato.** Las vistas (tablero, lista, tabla, calendario, cronograma) leen las
   mismas tareas; las relaciones entre módulos usan claves foráneas o una tabla genérica `links`.

## Módulos y relaciones

```
                ┌──────────── Objetivos (goals + key_results)
                │                    ▲ goal_id
Integrantes ── Proyectos ──┬── Columnas (tablero propio por proyecto)
 (roles,        │          ├── Tareas ── subtareas, checklist, dependencias, enlaces,
 permisos)      │          │             responsables, seguidores, etiquetas, comentarios
                │          ├── Canal de chat del proyecto
                │          ├── Documentos (pages.project_id) y archivos
                │          ├── Reuniones ── acuerdos (tareas con meeting_id) y decisiones
                │          └── Movimientos financieros y presupuestos (project_id)
                │
                └── Actividad · Notificaciones · Favoritos · Búsqueda global (FTS5)
```

- `links (a_type, a_id, b_type, b_id)`: relaciones flexibles muchos-a-muchos (página↔tarea,
  reunión↔página, archivo↔tarea, archivo↔movimiento, etc.).
- `activity`: bitácora única para historial por entidad, actividad del equipo y auditoría financiera.
- `search_index` (FTS5, sin acentos): títulos y contenido de tareas, proyectos, páginas, reuniones,
  decisiones, archivos, mensajes y objetivos. Los resultados se filtran por permisos.

## Finanzas (criterio de caja)

| Tipo de movimiento | Afecta resultado (ingresos/gastos) | Afecta saldo de cuenta | Genera obligación |
|---|---|---|---|
| `income` ingreso | + | + | — |
| `expense` gasto pagado por la empresa | − | − | — |
| `expense` pagado por un socio con dinero propio | − | no | **Reembolso por pagar** al socio |
| `contribution` aportación de capital | no | + | — |
| `loan_in` préstamo recibido (socio o tercero) | no | + | **Préstamo por devolver** |
| `reimbursement` / `repayment` | no | − | liquida la obligación |
| `transfer` entre cuentas | no | −origen / +destino | — |

- Cuentas por pagar/cobrar manuales: al registrar el pago se crea el gasto/ingreso correspondiente.
- Montos en **centavos enteros** (sin errores de redondeo).
- Movimientos pendientes de aprobación o anulados **no** cuentan en ningún total.
- Presupuestos: monto + periodo + categorías y/o proyecto. Si un gasto los excede se advierte o se exige
  aprobación (configurable por presupuesto). También hay un umbral global de aprobación.

## Tiempo real

`GET /api/events` (Server-Sent Events). El servidor emite **avisos de cambio** (`{topics:["tasks"]}`),
nunca datos; el cliente vuelve a pedir la información por la API normal, que aplica permisos.
Si la conexión se cae, el cliente reconecta y refresca al recuperar el foco.

Edición de documentos: guardado automático con control de versión optimista. Si dos personas editan la
misma página, el segundo guardado recibe `409` y la interfaz ofrece recargar o guardar su versión como copia.
Además se conservan versiones históricas restaurables.

## Seguridad

- Contraseñas con `scrypt` + sal; sesiones con token aleatorio (se guarda solo su hash), cookie
  `HttpOnly`, `SameSite=Lax`, `Secure` en producción.
- Las peticiones que modifican datos exigen la cabecera `X-PE-Client` (defensa CSRF adicional).
- Límite de intentos en inicio de sesión, invitaciones y recuperación.
- Invitaciones y recuperación por enlace de un solo uso con caducidad. Sin correo configurado, el
  administrador copia el enlace y lo comparte; **no se simula ningún envío**.
- Archivos fuera de cualquier carpeta pública; se sirven solo tras validar permisos.
- Respaldos automáticos diarios (`data/backups`) y descarga manual para administradores.

## Estructura del código

```
server/        API Express, base de datos, permisos, tareas programadas
  db/          esquema y migraciones
  lib/         utilidades: auth, permisos, actividad, notificaciones, búsqueda, eventos
  routes/      un archivo por módulo
client/        aplicación React (Vite)
  src/components  componentes reutilizables (UI premium minimalista)
  src/pages       pantallas por módulo
tests/api      pruebas de integración de la API (node:test)
tests/e2e      recorridos de usuario en navegador (Playwright)
```
