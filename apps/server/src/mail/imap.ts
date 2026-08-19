import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { getDb, nowIso } from '../db/index.js';
import { getSetting } from '../core/settings.js';
import { createLogger, redact } from '../util/logger.js';
import { messageAlreadySeen } from '../engine/store.js';
import { classify, statusForClassification, type Classification } from './classifier.js';
import type { ImapSettings, RequestRow } from '../types.js';

const log = createLogger('imap');

/**
 * Relevé de la boîte de réception.
 *
 * C'est ce qui rend le suivi automatique possible: sans lecture des réponses,
 * l'utilisateur devrait ouvrir chaque email, comprendre ce que le courtier
 * demande et cliquer lui-même. Ici, chaque réponse est rattachée à sa demande,
 * classée, et déclenche l'étape suivante.
 *
 * Portée volontairement étroite: on ne lit que les messages arrivés depuis le
 * dernier passage, on ne conserve que ceux qui correspondent à une demande en
 * cours, et rien n'est marque comme lu dans la boîte de l'utilisateur.
 */

export interface PollResult {
  scanned: number;
  matched: number;
  errors: string[];
}

function imapState(): { lastCheck?: string } {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('imap_state') as { value: string } | undefined;
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

function saveImapState(state: { lastCheck: string }): void {
  getDb()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run('imap_state', JSON.stringify(state), nowIso());
}

export async function verifyImap(settings: ImapSettings): Promise<{ ok: true } | { ok: false; error: string; hint?: string }> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    emitLogs: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(settings.mailbox || 'INBOX');
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (err) {
    const message = String((err as Error).message ?? err);
    const m = message.toLowerCase();
    let hint: string | undefined;
    if (m.includes('auth') || m.includes('login')) {
      hint = /gmail|google/.test(settings.host)
        ? "Utilisez le même mot de passe d'application que pour l'envoi, et vérifiez que l'accès IMAP est active dans Gmail."
        : "Identifiants refuses. Un mot de passe d'application est souvent nécessaire.";
    } else if (m.includes('enotfound')) hint = "Serveur IMAP introuvable.";
    else if (m.includes('timeout') || m.includes('etimedout')) hint = 'Délai dépassé: le port 993 est peut-être bloque.';
    return { ok: false, error: message, hint };
  }
}

/** Retrouve la demande à laquelle une réponse se rapporte. */
function matchRequest(parsed: ParsedMail, recipients: string[]): RequestRow | undefined {
  const db = getDb();

  // 1. En-têtes de discussion: le signal le plus fiable.
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])]
    .filter(Boolean)
    .flatMap((r) => String(r).split(/\s+/))
    .map((r) => r.trim())
    .filter(Boolean);
  for (const ref of refs) {
    const row = db.prepare('SELECT * FROM request WHERE message_id = ?').get(ref) as RequestRow | undefined;
    if (row) return row;
  }

  // 2. Sous-adressage: la réponse arrive sur user+rb.TOKEN@...
  for (const addr of recipients) {
    const m = /\+rb\.([a-z0-9]{6,16})@/i.exec(addr);
    if (m) {
      const row = db.prepare('SELECT * FROM request WHERE token = ?').get(m[1].toLowerCase()) as RequestRow | undefined;
      if (row) return row;
    }
  }

  // 3. Référence citée dans le sujet ou le corps.
  const haystack = `${parsed.subject ?? ''}\n${parsed.text ?? ''}`;
  const tokenMatch = /RB-([A-Z0-9]{6,16})/i.exec(haystack);
  if (tokenMatch) {
    const row = db.prepare('SELECT * FROM request WHERE token = ?').get(tokenMatch[1].toLowerCase()) as RequestRow | undefined;
    if (row) return row;
  }

  // 4. Dernier recours: domaine de l'expéditeur rapproché d'une demande ouverte.
  const from = parsed.from?.value?.[0]?.address ?? '';
  const domain = from.split('@')[1]?.toLowerCase();
  if (domain) {
    const row = db.prepare(`
      SELECT r.* FROM request r
      WHERE r.status IN ('sent','awaiting_reply','action_required','confirmed')
        AND (r.broker_id = ? OR r.broker_id LIKE ?)
      ORDER BY r.sent_at DESC LIMIT 1
    `).get(domain.replace(/\./g, '-'), `%${domain.split('.')[0]}%`) as RequestRow | undefined;
    if (row) return row;
  }

  return undefined;
}

export type OnReply = (payload: {
  request: RequestRow;
  classification: Classification;
  parsed: ParsedMail;
  messageId: string;
}) => void | Promise<void>;

/**
 * Relevé les nouveaux messages et rattache ceux qui répondent à une demande.
 * `onReply` reçoit chaque correspondance pour déclencher la suite (confirmation
 * automatique, changement de statut, notification).
 */
export async function pollInbox(onReply: OnReply): Promise<PollResult> {
  const settings = getSetting('imap');
  if (!settings.enabled || !settings.host || !settings.user) {
    return { scanned: 0, matched: 0, errors: [] };
  }

  const state = imapState();
  // Première exécution: on remonte a 7 jours pour rattraper les réponses
  // arrivées pendant la configuration, sans lire toute la boîte.
  const since = state.lastCheck ? new Date(state.lastCheck) : new Date(Date.now() - 7 * 86_400_000);
  const startedAt = nowIso();

  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    emitLogs: false,
  });

  const result: PollResult = { scanned: 0, matched: 0, errors: [] };

  try {
    await client.connect();
    const lock = await client.getMailboxLock(settings.mailbox || 'INBOX');
    try {
      for await (const message of client.fetch({ since }, { source: true, envelope: true, uid: true })) {
        result.scanned++;
        try {
          const parsed = await simpleParser(message.source as Buffer);
          const recipients = [
            ...(parsed.to ? toAddresses(parsed.to) : []),
            ...(parsed.cc ? toAddresses(parsed.cc) : []),
            String(parsed.headers.get('delivered-to') ?? ''),
            String(parsed.headers.get('x-original-to') ?? ''),
          ].filter(Boolean);

          const request = matchRequest(parsed, recipients);
          if (!request) continue;

          // La recherche IMAP `SINCE` ne connaît que le jour, pas l'heure: à
          // chaque relève de la journée, les mêmes messages reviennent. Sans
          // ce contrôle, une réponse était réenregistrée toutes les dix
          // minutes, l'historique se remplissait de doublons et un lien de
          // confirmation pouvait être suivi plusieurs fois.
          const messageId = String(parsed.messageId ?? message.uid);
          if (messageAlreadySeen(messageId)) continue;

          const classification = classify({
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
            html: typeof parsed.html === 'string' ? parsed.html : undefined,
            from: parsed.from?.value?.[0]?.address,
          });

          result.matched++;
          log.info('réponse rattachée', {
            broker: request.broker_id,
            type: classification.type,
            confiance: classification.confidence,
            de: redact(parsed.from?.value?.[0]?.address),
          });

          await onReply({ request, classification, parsed, messageId });
        } catch (err) {
          result.errors.push(String((err as Error).message));
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    saveImapState({ lastCheck: startedAt });
  } catch (err) {
    result.errors.push(String((err as Error).message));
    log.warn('relevé impossible', { raison: String((err as Error).message) });
    try { await client.logout(); } catch { /* deja ferme */ }
  }

  return result;
}

function toAddresses(field: ParsedMail['to']): string[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap((a) => a.value.map((v) => v.address ?? '')).filter(Boolean);
}

