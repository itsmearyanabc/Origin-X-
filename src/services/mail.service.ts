import nodemailer, { type Transporter } from "nodemailer";
import { config, isTest } from "../config.js";

/**
 * Transactional email over SMTP (any provider: Hostinger Mail, Resend, Brevo, SES, …).
 *
 * - Messages are sent in the background: callers never wait on SMTP, so response timing cannot
 *   reveal whether an account exists, and a mail outage never fails the user's request.
 * - Without SMTP outside production, messages are written to the server log so local development
 *   still works. Production refuses to start without SMTP (see config.ts).
 * - Links always use APP_URL; tokens are never logged in production.
 */

type Mail = { to: string; subject: string; text: string; html: string };

let transporter: Transporter | null = null;
function transport(): Transporter | null {
  if (!config.mail.host) return null;
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    requireTLS: !config.mail.secure && config.mail.requireTls,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, client-safe HTML: one message, one button, the raw link as fallback. */
function layout(heading: string, body: string, action?: { label: string; url: string }, footnote?: string) {
  const button = action
    ? `<p style="margin:28px 0"><a href="${esc(action.url)}" style="background:#F25C05;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">${esc(action.label)}</a></p>
       <p style="font-size:12px;color:#78716c;word-break:break-all">Or open this link: ${esc(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#fafaf9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1c1917">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-weight:800;letter-spacing:.04em;color:#F25C05;margin:0 0 24px">ORIGINX</p>
    <div style="background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#44403c">${body}</div>
      ${button}
    </div>
    <p style="font-size:12px;color:#a8a29e;margin-top:20px">${esc(footnote ?? "You received this email because of activity on your ORIGINX account.")}</p>
  </div></body></html>`;
}

const link = (path: string, token: string) => `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;

export class MailService {
  /** Fire-and-forget delivery; failures are logged without the message body or tokens. */
  send(mail: Mail): void {
    if (isTest) return;
    const t = transport();
    if (!t) {
      console.log(JSON.stringify({ level: "info", msg: "email (SMTP not configured — logged instead)", to: mail.to, subject: mail.subject, text: mail.text }));
      return;
    }
    t.sendMail({ from: config.mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }).catch((err: unknown) => {
      console.error(JSON.stringify({ level: "error", msg: "email delivery failed", to: mail.to, subject: mail.subject, error: err instanceof Error ? err.message : String(err) }));
    });
  }

  /** Verifies SMTP connectivity and credentials (used by /ready and at startup). */
  async check(): Promise<{ configured: boolean; ok: boolean; error?: string }> {
    const t = transport();
    if (!t) return { configured: false, ok: false };
    try {
      await t.verify();
      return { configured: true, ok: true };
    } catch (err) {
      return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  passwordReset(to: string, name: string, token: string) {
    const url = link("/reset-password", token);
    this.send({
      to,
      subject: "Reset your ORIGINX password",
      text: `Hi ${name},\n\nUse this link to choose a new password (valid for 60 minutes):\n${url}\n\nIf you didn't ask for this, ignore this email — your password stays the same.`,
      html: layout("Reset your password", `<p>Hi ${esc(name)},</p><p>Use the button below to choose a new password. The link is valid for 60 minutes and works once.</p>`, { label: "Choose a new password", url }, "If you didn't ask for this, ignore this email — your password stays the same."),
    });
  }

  emailVerification(to: string, name: string, token: string) {
    const url = link("/verify-email", token);
    this.send({
      to,
      subject: "Confirm your email for ORIGINX",
      text: `Hi ${name},\n\nConfirm your email address (link valid for 24 hours):\n${url}`,
      html: layout("Confirm your email", `<p>Hi ${esc(name)},</p><p>Confirm this address to finish setting up your ORIGINX account. The link is valid for 24 hours.</p>`, { label: "Confirm email", url }),
    });
  }

  invitation(to: string, organizationName: string, inviterName: string, role: string, token: string) {
    const url = link("/invite", token);
    const roleText = role.replace(/^ORG_/, "").toLowerCase();
    this.send({
      to,
      subject: `${inviterName} invited you to ${organizationName} on ORIGINX`,
      text: `${inviterName} invited you to join ${organizationName} on ORIGINX as ${roleText}.\n\nAccept the invitation (valid for 7 days):\n${url}`,
      html: layout(`Join ${organizationName} on ORIGINX`, `<p><strong>${esc(inviterName)}</strong> invited you to join <strong>${esc(organizationName)}</strong> as <strong>${esc(roleText)}</strong>.</p><p>The invitation is valid for 7 days.</p>`, { label: "Accept invitation", url }, "If you weren't expecting this, you can ignore this email."),
    });
  }

  /** Internal notification to the platform team (optional MAIL_ADMIN_NOTIFY). */
  notifyAdmins(subject: string, text: string, path: string) {
    if (!config.mail.adminNotify) return;
    const url = `${config.appUrl}${path}`;
    this.send({ to: config.mail.adminNotify, subject: `[ORIGINX] ${subject}`, text: `${text}\n\n${url}`, html: layout(subject, `<p>${esc(text)}</p>`, { label: "Open admin console", url }, "Platform notification for ORIGINX administrators.") });
  }
}

export const mailService = new MailService();
