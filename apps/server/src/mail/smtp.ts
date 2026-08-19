import nodemailer, { type Transporter } from 'nodemailer';
import { getSetting } from '../core/settings.js';
import { createLogger, redact } from '../util/logger.js';
import { plusAddress } from './providers.js';
import type { SmtpSettings } from '../types.js';

const log = createLogger('smtp');

/**
 * Envoi des demandes.
 *
 * L'application utilise la boîte de l'utilisateur, jamais un relais tiers:
 * l'adresse d'expédition doit correspondre a l'identité dont on demande la
 * suppression, sinon les courtiers rejettent la demande comme non vérifiée.
 */

let transporter: Transporter | null = null;
let transporterFingerprint = '';

function fingerprintOf(s: SmtpSettings): string {
  return `${s.host}:${s.port}:${s.secure}:${s.user}:${s.password.length}`;
}

/**
 * Le serveur d'envoi tourne-t-il sur cette machine ?
 *
 * Proton Mail Bridge, msmtp et les relais locaux écoutent sur la boucle locale
 * avec un certificat auto-signé. Leur imposer TLS vérifié rendait l'envoi
 * impossible, alors que le trafic ne quitte jamais l'ordinateur: il n'y a rien
 * à chiffrer contre un tiers, et aucune autorité à vérifier.
 */
function isLoopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase());
}

export function getTransporter(settings?: SmtpSettings): Transporter {
  const s = settings ?? getSetting('smtp');
  if (!s.host || !s.user) throw new Error("Aucun serveur d'envoi configuré.");

  const fp = fingerprintOf(s);
  if (transporter && fp === transporterFingerprint) return transporter;

  const local = isLoopback(s.host);
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.password },
    // Les campagnes envoient des dizaines de messages: une connexion réutilisée
    // et un rythme borne évitent d'être pris pour un envoi de masse.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    rateDelta: 60_000,
    rateLimit: 20,
    requireTLS: !s.secure && !local,
    tls: local ? { rejectUnauthorized: false } : { minVersion: 'TLSv1.2' },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
  transporterFingerprint = fp;
  return transporter;
}

export function resetTransporter(): void {
  transporter?.close();
  transporter = null;
  transporterFingerprint = '';
}

/** Vérifié les identifiants et traduit les erreurs en langage compréhensible. */
export async function verifySmtp(settings: SmtpSettings): Promise<{ ok: true } | { ok: false; error: string; hint?: string }> {
  const t = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
    requireTLS: !settings.secure && !isLoopback(settings.host),
    tls: isLoopback(settings.host) ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  try {
    await t.verify();
    log.info('serveur SMTP vérifié', { host: settings.host, user: redact(settings.user) });
    return { ok: true };
  } catch (err) {
    const message = String((err as Error).message ?? err);
    return { ok: false, error: message, hint: explainSmtpError(message, settings) };
  } finally {
    t.close();
  }
}

function explainSmtpError(message: string, settings: SmtpSettings): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login') || m.includes('535') || m.includes('authentication failed')) {
    if (/gmail|google/.test(settings.host)) {
      return "Google refuse le mot de passe habituel. Créez un mot de passe d'application sur https://myaccount.google.com/apppasswords et collez les 16 caractères ici.";
    }
    return "Identifiants refuses. Si votre messagerie utilise la validation en deux étapes, il faut un mot de passe d'application, pas votre mot de passe habituel.";
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) return "Serveur introuvable. Vérifiez l'adresse du serveur d'envoi.";
  if (m.includes('etimedout') || m.includes('timeout')) return 'Délai dépassé. Un pare-feu ou un antivirus bloque peut-être le port utilise.';
  if (m.includes('econnrefused')) return 'Connexion refusée. Le port est probablement incorrect (587 avec STARTTLS, ou 465 avec SSL).';
  if (m.includes('self signed') || m.includes('certificate')) return 'Certificat TLS non reconnu. Vérifiez le nom du serveur.';
  return "Vérifiez l'adresse du serveur, le port et le mot de passe.";
}

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  token: string;
  /** Rattache le message à une discussion existante lors des relances. */
  inReplyTo?: string;
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  raw: string;
}

export async function sendMail(options: SendOptions): Promise<SendResult> {
  const s = getSetting('smtp');
  const from = s.fromName ? `"${s.fromName}" <${s.fromEmail || s.user}>` : s.fromEmail || s.user;
  const replyTo = plusAddress(s.fromEmail || s.user, options.token);

  const info = await getTransporter(s).sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    replyTo,
    inReplyTo: options.inReplyTo,
    references: options.inReplyTo ? [options.inReplyTo] : undefined,
    headers: {
      // Marque le message comme correspondance personnelle et non commerciale:
      // certains filtres classent mieux une demande ainsi identifiée.
      'X-RemoveBroker-Ref': `RB-${options.token.toUpperCase()}`,
      'Auto-Submitted': 'no',
    },
  });

  log.info('demande envoyée', { destinataire: redact(options.to), ref: options.token });

  return {
    messageId: String(info.messageId ?? ''),
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
    raw: [
      `From: ${from}`,
      `To: ${options.to}`,
      replyTo ? `Reply-To: ${replyTo}` : '',
      `Subject: ${options.subject}`,
      `Message-ID: ${info.messageId ?? ''}`,
      `Date: ${new Date().toUTCString()}`,
      '',
      options.text,
    ].filter(Boolean).join('\n'),
  };
}
