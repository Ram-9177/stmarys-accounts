import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!config.mailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Best-effort notification email. Never throws: a mail outage must not block account actions. */
export async function sendMail(to: string | null | undefined, subject: string, text: string): Promise<boolean> {
  const t = getTransport();
  if (!t || !to) return false;
  try {
    await t.sendMail({ from: config.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error('Email send failed:', (err as Error).message);
    return false;
  }
}

/** Test hook. */
export function setTransportForTests(t: Transporter | null): void {
  transporter = t;
}
