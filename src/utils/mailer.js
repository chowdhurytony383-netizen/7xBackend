import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let cachedTransporter = null;

function hasSmtpConfig() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function getTransporter() {
  if (!hasSmtpConfig()) return null;

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return cachedTransporter;
}

function getFromAddress() {
  const email = env.MAIL_FROM_EMAIL || env.SMTP_USER;
  const name = env.MAIL_FROM_NAME || '7XBET';
  return email ? `${name} <${email}>` : name;
}

export async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('--- 7XBET MAIL OUTBOX ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(text || html || '');
    console.log('SMTP is not configured. Add SMTP_HOST, SMTP_USER and SMTP_PASS in Render backend env to send real email.');
    console.log('-------------------------');
    return true;
  }

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });

  return true;
}
