# Informe del proyecto · Planta-Emporio

Plataforma web privada para organizar la empresa: trabajo, conocimiento, comunicación y dinero en un solo lugar.
Este informe resume qué se construyó, cómo funciona, qué se probó, qué limitaciones existen y qué conviene
hacer después.

---

## 1. Decisiones de arquitectura

| Decisión | Por qué |
|---|---|
| **Node.js + SQLite en un solo servidor** | Cero servicios externos o de pago; un archivo de base de datos fácil de respaldar; sobra capacidad para un equipo pequeño. |
| **React (Vite) + diseño propio** | Interfaz minimalista tipo Notion, sin aspecto de panel administrativo genérico; tema claro/oscuro y móvil. |
| **Permisos en el servidor** | Cada petición valida sesión, rol y visibilidad. La interfaz solo oculta lo que el servidor ya impide. |
| **Server-Sent Events** | Los cambios (tareas, chat, documentos, finanzas…) llegan al instante a quien tenga permiso; si se pierde la conexión, se reconecta y refresca. |
| **Criterio de caja en finanzas, montos en centavos** | Números exactos y fáciles de entender; aportaciones, préstamos y reembolsos nunca se confunden con ingresos o gastos. |
| **Nada se borra en silencio** | Papelera recuperable; movimientos financieros se **anulan** con motivo; historial de quién hizo qué. |

Detalle técnico en [ARQUITECTURA.md](ARQUITECTURA.md).

---

## 2. Módulos implementados

### Inicio (centro de control)
- **Para mí:** tareas para hoy y vencidas, mis tareas, lo que necesita mi atención (tareas en revisión de mis
  proyectos, bloqueadas, tareas de otros que esperan a que termine algo), decisiones por aprobar, próximas
  reuniones, recordatorios, mis proyectos con avance, resumen financiero (solo con permiso), lo que la empresa
  me debe, notificaciones y actividad reciente.
- **Empresa:** proyectos y su progreso, tareas pendientes/atrasadas/bloqueadas, **carga de trabajo por
  integrante**, vencimientos de 14 días, objetivos, finanzas resumidas y actividad.
- Accesos rápidos (tarea, nota, proyecto, gasto, reunión, idea) y **personalización** (mostrar/ocultar y
  reordenar secciones).
- **Primeros pasos** guiados para configurar el espacio.

### Proyectos y tareas
- Proyectos con nombre, descripción, objetivo, resultado esperado, responsable, integrantes, fechas, prioridad,
  estado, etiquetas, visibilidad (equipo o **privado para sus integrantes**), objetivo vinculado, documentos,
  archivos, reuniones, comentarios, actividad y **canal de chat propio**.
- **5 plantillas incluidas** (lanzamiento, evento, campaña, operación mensual con tareas recurrentes,
  formalización) y **plantillas propias** a partir de cualquier proyecto.
- **Tablero Kanban** con columnas editables (renombrar, reordenar, cambiar el estado que representan, eliminar
  moviendo sus tareas), **arrastrar y soltar** (ratón y táctil) y creación rápida en cada columna.
- **Vistas sincronizadas**: lista (agrupada por fecha, estado, prioridad o proyecto), tabla editable, calendario
  (arrastrar para cambiar la fecha) y cronograma con dependencias. Filtros por responsable, estado, prioridad,
  proyecto, etiqueta y fecha; **vistas guardadas** («Pendientes urgentes», compartibles y favoritas).
- Tarea: solo el título es obligatorio. Incluye responsables, fechas, prioridad, estado, etiquetas, subtareas,
  lista de verificación, comentarios con @menciones, archivos, enlaces, documentos relacionados, dependencias
  (sin ciclos), tiempo estimado e invertido, recurrencia, seguidores, recordatorio personal e **historial** de
  cambios con valores anteriores.

### Documentos (wiki)
- Páginas y subpáginas jerárquicas, editor de bloques en español (encabezados, listas, listas de verificación,
  tablas, imágenes, archivos, citas, código; bloques reordenables arrastrando).
- **@menciones** de personas, tareas, proyectos, documentos, reuniones y objetivos dentro del texto, con
  «páginas que mencionan esta».
- **Guardado automático** con indicador, aviso si intentas cerrar con cambios pendientes, reintento sin
  conexión, **detección de edición simultánea** (no sobrescribe: ofrece guardar tu versión como copia, ver la
  actual o reemplazar) e **historial de versiones restaurable**.
- 6 plantillas (reunión, propuesta, plan de trabajo, revisión semanal, ideas, proceso) y plantillas propias.
- Páginas privadas, vínculo a proyectos/tareas/reuniones, archivos y comentarios.

### Finanzas
- Movimientos: **ingreso, gasto, aportación de socio, préstamo recibido y transferencia**, con concepto,
  monto, fecha, categoría, cuenta, proyecto, integrante, contraparte, método de pago, notas y **comprobantes**
  (visibles solo para finanzas).
- **Gasto pagado por un integrante con su dinero:** no sale de la caja y genera automáticamente el reembolso
  pendiente; al reembolsar no se duplica el gasto.
- **Socios:** capital aportado, préstamos por devolver, reembolsos pendientes y pagados por persona.
- **Cuentas por pagar y cobrar** con vencimiento, pagos parciales y recordatorios; al pagar/cobrar se crea el
  movimiento real.
- **Presupuestos** por periodo, proyecto y categorías, con porcentaje de alerta y opción de **pedir
  aprobación** si se exceden. Umbral global de aprobación configurable.
- **Resumen** con ingresos, gastos, balance, saldo por cuenta, entradas y salidas de caja, gráfica mensual
  (con tabla alternativa), gastos e ingresos por categoría y por proyecto, obligaciones, presupuestos y
  aprobaciones pendientes. Filtros por periodo y proyecto.
- **Reportes** por categoría, proyecto, mes, responsable o cuenta y **exportación CSV** (abre en Excel con
  acentos correctos).
- Anulación controlada con motivo, historial de ediciones con valores anteriores y permisos separados para
  consultar, registrar y aprobar. **No se generan datos financieros ficticios**: la cuenta inicial «Caja
  principal» empieza en $0 y las categorías sugeridas son editables.

### Chat
- Canal General, canales por tema, **un canal por proyecto** y **mensajes directos privados**.
- Respuestas, @menciones con notificación, archivos e imágenes (también pegando o arrastrando), edición y
  eliminación propia, búsqueda que respeta permisos, marcador de «Nuevos» y contadores de no leídos.
- Los mensajes se guardan en el servidor y llegan en tiempo real.

### Reuniones, acuerdos y decisiones
- Reuniones con fecha, duración, lugar o enlace, participantes, objetivo, agenda y notas (guardado
  automático), cambios de estado y documento de notas a partir de plantilla.
- **Acuerdos como tareas** con responsable y fecha, ligados a la reunión.
- **Registro de decisiones** buscable: se aprueban explícitamente por las personas elegidas (quien propone no
  se aprueba a sí mismo); nada se vuelve definitivo sin confirmación. Las resueltas no se reescriben: se marcan
  como reemplazadas.

### Objetivos
- Objetivos por periodo con responsable, fecha y estado; **indicadores medibles** (valor inicial, meta, actual).
- El avance usa los indicadores o, si no hay, las tareas de los proyectos vinculados.

### Integrantes, roles y permisos
- Perfil (foto o color, puesto, teléfono), preferencias de tema, menú y notificaciones.
- Roles **Administrador, Socio e Integrante**, roles personalizados y una **matriz de 9 permisos** editable.
- **Invitaciones** por enlace de un solo uso (7 días), **recuperación de contraseña** por correo o enlace
  generado por un administrador, desactivación de cuentas (conserva el historial) y protección para no quedar
  sin administradores.

### Archivos
- Carpetas, subida con progreso (arrastrar y soltar), búsqueda, vista previa de imágenes, PDF, texto y video,
  descarga, renombrar, mover y **visibilidad** (equipo, solo finanzas, solo yo). Cuota de almacenamiento y
  tamaño máximo por archivo. Los archivos se sirven solo tras validar permisos; los HTML se descargan, nunca se
  ejecutan.

### Funciones transversales
- **Búsqueda global** (⌘K / Ctrl+K) en tareas, proyectos, documentos (también su contenido), reuniones,
  decisiones, objetivos, archivos, mensajes e integrantes; ignora acentos y respeta permisos. También funciona
  como menú de acciones rápidas.
- **Bandeja de entrada** para capturar ideas y convertirlas en tarea, nota o recordatorio.
- **Favoritos**, **notificaciones** configurables por tipo, **recordatorios**, **actividad** del equipo,
  **papelera** (restaurar; borrado definitivo solo administración).
- **Automatizaciones** transparentes y desactivables: aviso al bloquearse una tarea, al pasar a revisión,
  vencimientos de tareas, pagos/cobros y reuniones; reglas propias (notificar, asignar, cambiar prioridad).
  Nunca disparan otras reglas en cadena.
- **Respaldos** automáticos diarios y manuales descargables.

---

## 3. Pruebas realizadas

Todas se ejecutaron en este entorno y pasaron:

| Conjunto | Resultado |
|---|---|
| `npm test` — integración de la API con base de datos temporal | **40 / 40** |
| `npm run test:e2e` — recorridos en navegador (Chromium) | **13 / 13** |

**API (40):** configuración inicial, inicio de sesión, CSRF, invitaciones de un solo uso, recuperación de
acceso, desactivación de cuentas y protección del último administrador; cálculos financieros exactos en
centavos, validaciones, gasto pagado por un socio y reembolso parcial, aportaciones y préstamos que no son
ingresos, transferencias, anulación con motivo, historial de ediciones, presupuesto con aprobación, umbral
global, cuentas por cobrar, permisos financieros por rol, reportes y CSV; plantillas de proyecto,
sincronización estado ↔ columna, permisos de asignación, automatizaciones, recurrencia (incluido fin de mes),
subtareas/checklist/dependencias sin ciclos, papelera, proyectos privados (también en chat y búsqueda),
documentos con conflicto de edición, versiones, búsqueda sin acentos, páginas privadas, chat con no leídos y
mensajes directos privados, reuniones y decisiones con aprobación, archivos con permisos y comprobantes
privados, bandeja, objetivos, vistas, favoritos, panel de empresa y **persistencia tras reiniciar**.

**Recorridos E2E (13):** crear el espacio; errores de inicio de sesión y sesión tras recargar; invitar y aceptar
(y que el enlace no se reutilice); proyecto desde plantilla, **arrastrar una tarjeta** y verla igual tras
recargar en lista y tabla; asignar una tarea y que la persona la vea y reciba la notificación; **chat en tiempo
real** entre dos navegadores; documento con guardado automático, vínculo a proyecto y búsqueda por contenido;
**registrar ingresos y gastos y verificar totales** y la anulación; permisos de un integrante sin acceso a
finanzas ni configuración; reunión con acuerdo y decisión aprobada por otra persona; papelera; **edición
simultánea** sin pérdida de trabajo; y en tamaño de **teléfono**: sin desplazamiento horizontal en las pantallas
principales y creación de tareas desde el botón +.

Además se revisaron capturas de pantalla en escritorio y móvil, en tema claro y oscuro, y se validaron los
colores de las gráficas para daltonismo y contraste.

Durante las pruebas se encontraron y corrigieron errores reales, por ejemplo: quien proponía una decisión
quedaba como su propio aprobador; el detalle de tarea no traía sus contadores; textos de fecha mal
capitalizados.

### Lo que no se pudo probar aquí
- **Imagen Docker:** no hay servicio de Docker en este entorno. Se simuló la etapa final (instalación solo
  de producción + servidor + aplicación compilada) y arrancó correctamente.
- **Dispositivos reales y otros navegadores** (Safari/iPhone, Firefox): se probó Chromium con emulación de
  iPhone 13. El arrastre táctil del tablero (mantener presionado) no se probó con un dedo real.
- **Envío de correos:** no hay SMTP configurado; se verificó que, sin él, la aplicación lo indica y no simula
  envíos.
- **Despliegue con HTTPS y dominio:** pendiente de tu decisión (ver sección 5).

---

## 4. Limitaciones conocidas

- **Edición de documentos:** dos personas no escriben a la vez sobre el mismo texto como en Google Docs; si
  ocurre, se detecta y nadie pierde su trabajo (copia, ver actual o reemplazar con historial).
- **Correo:** sin SMTP no hay correos (las invitaciones y recuperaciones se comparten con enlace). No hay
  resumen diario por correo ni notificaciones push al teléfono.
- **Exportación:** CSV compatible con Excel; no se genera un `.xlsx` nativo.
- **Vista previa:** imágenes, PDF, texto y video. Word/Excel/PowerPoint se descargan.
- **Cronograma:** de consulta (las fechas se editan en la tarea o arrastrando en el calendario). Arrastrar en
  el calendario es para escritorio; en el teléfono la fecha se cambia en la tarea.
- **Recurrencia:** la siguiente tarea se crea al completar la actual (no se generan ocurrencias futuras por
  adelantado).
- **Finanzas:** registro administrativo con criterio de caja; **no es contabilidad fiscal** (sin facturación,
  impuestos ni conciliación bancaria). Quien tiene permiso de aprobar no queda bloqueado por presupuestos.
- **Escala:** pensada para un equipo pequeño en un solo servidor (SQLite). No se hicieron pruebas de carga;
  si la empresa creciera a muchas decenas de personas conectadas a la vez, convendría revisarlo.
- **IA:** no implementada (ver recomendaciones).

---

## 5. Decisiones que necesitan tu aprobación

No se activó nada que implique costo, servicios externos o datos sensibles fuera del servidor:

1. **Alojamiento y dominio** (costo mensual). Opciones típicas: un VPS pequeño (≈ 5–7 USD/mes) con Caddy para
   HTTPS, o plataformas como Railway, Fly.io o Render. Requiere un dominio (≈ 10–15 USD/año).
2. **Correo SMTP** para invitaciones y recuperación (el correo de tu dominio o un servicio transaccional).
3. **Respaldo fuera del servidor** (por ejemplo, copiar `data/` a un almacenamiento externo cada noche).
4. **Asistente con IA** (costo por uso de un proveedor de IA).
5. **Conexión con bancos o pagos:** no recomendada por ahora; requeriría evaluación de seguridad.

---

## 6. Recomendaciones para siguientes etapas

1. **Desplegar** con HTTPS y respaldo externo automático (lo más importante para empezar a usarla a diario).
2. **Aplicación instalable (PWA)** con notificaciones push en el teléfono y modo sin conexión para capturar.
3. **Resumen semanal por correo** (tareas vencidas, decisiones pendientes, números del mes).
4. **Asistente con IA** que solo use lo que cada persona puede ver y nunca modifique finanzas ni envíe
   mensajes sin confirmación: resumir proyectos, convertir notas de reunión en tareas, detectar atrasos y
   sugerir prioridades.
5. **Edición colaborativa en tiempo real** de documentos (Yjs) si el equipo empieza a co-escribir mucho.
6. **Módulo comercial:** inventario, catálogo de productos, ventas y clientes ligados a ingresos.
7. **Sincronización de calendario** (enlace iCal para Google/Apple Calendar).
8. **Exportación `.xlsx`** y lectura de comprobantes (OCR) para capturar gastos con una foto.
9. **Verificación en dos pasos** para cuentas de administración.
