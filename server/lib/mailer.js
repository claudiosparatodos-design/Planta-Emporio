import { config } from '../config.js';

let transport = null;

/** Correo disponible: Brevo (API HTTPS) o SMTP. */
export const mailConfigured = () => Boolean((config.brevo && config.mailFrom) || config.smtp);

export function mailProvider() {
  if (config.brevo && config.mailFrom) return 'brevo';
  if (config.smtp) return 'smtp';
  return null;
}

/**
 * Envía un correo solo si hay un proveedor configurado. Nunca simula un envío:
 * devuelve { sent: false } para que la interfaz muestre el enlace a compartir manualmente.
 */
export async function sendMail({ to, subject, text, fromName = 'Planta-Emporio' }) {
  const provider = mailProvider();
  if (!provider) return { sent: false, reason: 'not_configured' };
  try {
    if (provider === 'brevo') {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': config.brevo.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { email: config.mailFrom, name: fromName }, to: [{ email: to }], subject, textContent: text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Brevo respondió ${res.status}: ${detail.slice(0, 300)}`);
      }
      return { sent: true };
    }
    if (!transport) {
      const nodemailer = await import('nodemailer');
      transport = nodemailer.default.createTransport(config.smtp);
    }
    await transport.sendMail({ from: config.smtp.from || config.mailFrom, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error('[correo] Error al enviar:', err.message);
    return { sent: false, reason: 'error', error: err.message };
  }
}
