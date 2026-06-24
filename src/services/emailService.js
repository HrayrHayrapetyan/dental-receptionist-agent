// Email notification per PRD 2.5. Sends the dentist a booking summary
// immediately after a successful booking. Falls back to console logging
// when SMTP is not configured.

import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

const hasSmtp = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

export async function sendBookingNotification(config, slot, patient) {
  const bookedAt = new Date();
  const subject = `New booking — ${patient.name} — ${slot.start.toLocaleString('de-DE', {
    timeZone: config.businessHours.timezone
  })}`;

  const body = [
    `New appointment booked via AI receptionist for ${config.practiceName}.`,
    '',
    `Patient name:   ${patient.name}`,
    `Age / DOB:      ${patient.age}`,
    `Phone:          ${patient.phone}`,
    `Reason:         ${patient.reason}`,
    `Appointment:    ${slot.start.toLocaleString('de-DE', { timeZone: config.businessHours.timezone })}`,
    `                – ${slot.end.toLocaleString('de-DE', { timeZone: config.businessHours.timezone })}`,
    `Booked at:      ${bookedAt.toISOString()}`
  ].join('\n');

  const message = {
    from: process.env.EMAIL_FROM || 'bookings@example.com',
    to: config.notificationEmail,
    subject,
    text: body
  };

  if (!hasSmtp()) {
    logger.warn('SMTP not configured — printing notification email to console');
    console.log('\n──────── BOOKING NOTIFICATION EMAIL ────────');
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${subject}`);
    console.log(body);
    console.log('────────────────────────────────────────────\n');
    return { mocked: true };
  }

  const info = await getTransporter().sendMail(message);
  logger.info('Sent booking notification email', { to: message.to, messageId: info.messageId });
  return info;
}
