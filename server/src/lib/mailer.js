import { createTransport } from "nodemailer";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

// Without SMTP (dev/test) messages are kept in memory and logged instead of sent.
const transport = createTransport(config.SMTP_URL ?? { jsonTransport: true });
export const outbox = [];

// Plain-text only: no HTML templating means nothing user-supplied can inject markup.
export async function sendMail({ to, subject, text }) {
  await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
  if (!config.SMTP_URL) {
    outbox.push({ to, subject, text });
    logger.info({ subject, text }, "email (not sent: SMTP_URL unset)");
  }
}

// Callers don't await delivery: response time must not reveal whether an email was sent.
export const sendMailInBackground = (message) =>
  sendMail(message).catch((err) => logger.error({ err, subject: message.subject }, "email delivery failed"));
