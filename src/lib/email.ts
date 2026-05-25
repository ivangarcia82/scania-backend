import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = env.NODE_ENV === 'test' ? null : new Resend(env.RESEND_API_KEY);

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (env.NODE_ENV === 'test') return; // tests mock this module directly
  if (!resend) return;

  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject: 'Restablece tu contraseña',
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetUrl}">Haz clic aquí para crear una nueva contraseña</a></p>
      <p>Este enlace expira en 1 hora. Si no fuiste tú, ignora este correo.</p>
    `,
    text: `Restablece tu contraseña: ${resetUrl}\n\nEste enlace expira en 1 hora.`,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
