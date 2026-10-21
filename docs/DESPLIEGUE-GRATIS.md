# Publicar Planta-Emporio gratis (sin tarjeta de crédito)

Usaremos tres servicios con plan gratuito que **no piden tarjeta**:

| Servicio | Para qué | Plan gratuito |
|---|---|---|
| **Render** | Ejecuta la aplicación y le da una dirección web con HTTPS (`https://….onrender.com`) | 750 horas al mes (alcanza para tenerla encendida todo el mes) |
| **Turso** | Guarda todos los datos y archivos de forma permanente | 5 GB |
| **Brevo** *(opcional)* | Envía correos de invitación y de recuperación de contraseña | 300 correos al día |

> **¿Por qué no Netlify?** Netlify (igual que Vercel) solo publica sitios estáticos y funciones de corta duración:
> no tiene un servidor encendido ni disco permanente, y esta aplicación necesita ambos (chat en tiempo real,
> recordatorios, base de datos). Render sí ejecuta el servidor; su disco gratuito se borra al dormir, por eso
> la aplicación copia cada cambio a Turso en segundos y lo restaura sola al despertar.

Tiempo estimado: 20–30 minutos. No necesitas instalar nada en tu computadora.

---

## 1. Turso: la base de datos (obligatorio)

1. Entra a <https://turso.tech> y crea una cuenta con GitHub (botón *Sign up*). No pide tarjeta.
2. En el panel, crea una base de datos (*Create Database*). Nombre sugerido: `planta-emporio`.
   Elige la región más cercana a ustedes (por ejemplo, una de Estados Unidos).
3. Abre la base de datos y copia su **URL**. Empieza con `libsql://…` → la usarás como `TURSO_DATABASE_URL`.
4. En la misma pantalla crea un **token** (*Create Token* / *Generate Token*), con permiso de lectura y
   escritura y sin fecha de expiración. Cópialo → será `TURSO_AUTH_TOKEN`.

Guarda ambos datos en un lugar privado: dan acceso a toda la información de la empresa.

## 2. Brevo: el correo (opcional)

Sin este paso todo funciona igual: las invitaciones y recuperaciones se comparten con un enlace.

1. Crea una cuenta en <https://www.brevo.com> (plan *Free*, sin tarjeta).
2. Agrega y **verifica un remitente** (*Senders, Domains & Dedicated IPs → Senders*): por ejemplo tu Gmail.
   Brevo te enviará un correo para confirmarlo.
3. Ve a *SMTP & API → API Keys* y genera una **API key** → será `BREVO_API_KEY`.
4. El correo del remitente verificado será `MAIL_FROM`.

> Al enviar desde una dirección gratuita (Gmail, Outlook) sin dominio propio, algunos correos pueden llegar a
> **spam**. Pide a tus socios que revisen esa carpeta y marquen el correo como «No es spam».

## 3. Render: publicar la aplicación

1. Crea una cuenta en <https://render.com> entrando con **GitHub** (no pide tarjeta para el plan gratuito).
   Autoriza a Render a ver el repositorio `Planta-Emporio`.
2. En el panel elige **New → Blueprint** y selecciona el repositorio `Planta-Emporio`.
   Si te pregunta por la rama, elige la que contiene el código (`claude/bold-shannon-ncxoj7`, o `main`
   si ya la fusionaste).
3. Render leerá el archivo `render.yaml` y te pedirá los valores secretos:
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (paso 1) — **obligatorios**.
   - `BREVO_API_KEY` y `MAIL_FROM` (paso 2) — déjalos vacíos si no usarás correo.
4. Confirma con **Apply**. La primera construcción tarda unos minutos.
5. Abre la dirección que te da Render (`https://planta-emporio-xxxx.onrender.com`). Verás la pantalla de
   bienvenida: crea el espacio y tu cuenta de administración.
6. En **Configuración → Espacio de trabajo → Servicios** comprueba:
   - *Almacenamiento de datos*: «Respaldo continuo en Turso activo».
   - *Correo*: «Activo con Brevo» y el botón **Enviar correo de prueba**.

Si no configuraste Turso, la aplicación mostrará a los administradores una barra roja avisando que los datos
**no** son permanentes. No la uses así.

---

## Cómo se comporta el plan gratuito

- **Se duerme tras 15 minutos sin uso.** La siguiente visita tarda alrededor de **1 minuto** en abrir; después
  va normal. Los datos no se pierden: se restauran desde Turso al despertar.
- Mientras está dormida no corre el programador de **recordatorios**; los avisos de vencimientos se envían
  cuando alguien vuelve a abrirla (los de reuniones con una hora de anticipación pueden no llegar a tiempo).
- **Opcional, para que esté siempre despierta:** crea un monitor gratuito en <https://uptimerobot.com> o
  <https://cron-job.org> que visite `https://TU-DIRECCION.onrender.com/api/health` cada 10 minutos. Las 750 horas
  gratuitas al mes alcanzan para tenerla encendida todo el mes.
- Cada cambio se envía a Turso en unos segundos y los archivos se guardan allí antes de confirmar la subida.
  Solo un fallo brusco del servidor justo en esos segundos podría perder el último cambio.
- Turso conserva además una copia completa por día de la última semana.
- **Límites:** archivos de hasta 10 MB y 3.5 GB en total (para quedar dentro de los 5 GB gratuitos de Turso).

## Actualizar la aplicación

Cada vez que se suban cambios a la rama conectada en GitHub, Render vuelve a publicarla sola. Los datos no se
pierden: viven en Turso.

## Si algún día quieren más

Todo lo anterior es gratuito. Si en el futuro deciden pagar (por ejemplo, ~7 USD/mes por un servidor de
Render que no se duerme), la aplicación funciona igual y Turso puede seguir guardando los datos.

## Si usas una computadora prestada o compartida

Toda la información vive en la nube (Render y Turso); en la computadora no se guarda nada de la empresa.
Aun así, el navegador puede recordar cosas. Para no dejar rastro:

- Abre una **ventana privada / de incógnito** para crear las cuentas y para entrar a la aplicación.
- Al entrar, deja **sin marcar** «Mantener la sesión iniciada»: la sesión se cierra al cerrar el navegador
  (y en el servidor caduca a las 12 horas de todos modos).
- **No guardes las contraseñas** cuando el navegador lo ofrezca, ni descargues los tokens de Turso o Brevo a
  archivos: cópialos y pégalos directamente en Render.
- Al terminar, **cierra sesión** en la aplicación, en GitHub, Render, Turso y Brevo, y cierra el navegador.
- Si olvidaste cerrar sesión, desde cualquier otro equipo ve a **Configuración → Mi perfil → Cerrar sesión en
  todos los equipos**.
