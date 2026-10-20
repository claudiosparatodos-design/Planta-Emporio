import { config } from '../config.js';

let transport = null;

export const mailConfigured = () => Boolean(config.smtp);

/**
 * Envía un correo solo si hay SMTP configurado. Nunca simula un envío:
 * devuelve { sent: false } para que la interfaz muestre el enlace a compartir manualmente.
 */
export async function sendMail({ to, subject, text }) {
  if (!config.smtp) return { sent: false, reason: 'not_configured' };
  try {
    if (!transport) {
      const nodemailer = await import('nodemailer');
      transport = nodemailer.default.createTransport(config.smtp);
    }
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error('[correo] Error al enviar:', err.message);
    return { sent: false, reason: 'error', error: err.message };
  }
}
