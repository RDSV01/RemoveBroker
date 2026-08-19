import crypto from 'node:crypto';
import { addDays, getDb, nowIso } from '../db/index.js';
import { encrypt, decrypt } from '../crypto/cipher.js';
import { getSetting } from '../core/settings.js';
import type { RequestMethod, RequestRow, RequestStatus } from '../types.js';
import { bus } from './bus.js';

/** Accès en lecture et écriture aux demandes, à leur chronologie et aux preuves. */

export function newId(): string {
  return crypto.randomUUID();
}

/** Jeton court cité dans les emails pour rattacher les réponses. */
export function newToken(): string {
  return crypto.randomBytes(5).toString('hex');
}

export function createRequest(input: {
  campaignId: string | null;
  brokerId: string;
  brokerName: string;
  method: RequestMethod;
  legalBasis?: string;
  deadlineDays?: number;
}): RequestRow {
  const id = newId();
  const token = newToken();
  const deadline = addDays(input.deadlineDays ?? 30);
  getDb().prepare(`
    INSERT INTO request (id, campaign_id, broker_id, broker_name, method, status, legal_basis, token, deadline_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `).run(id, input.campaignId, input.brokerId, input.brokerName, input.method, input.legalBasis ?? null, token, deadline);
  const row = getRequest(id)!;
  addEvent(id, 'created', `Demande créée pour ${input.brokerName}`);
  return row;
}

export function getRequest(id: string): RequestRow | undefined {
  return getDb().prepare('SELECT * FROM request WHERE id = ?').get(id) as RequestRow | undefined;
}

export function updateRequest(id: string, patch: Partial<RequestRow>): void {
  const keys = Object.keys(patch).filter((k) => k !== 'id');
  if (!keys.length) return;
  const assignments = keys.map((k) => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE request SET ${assignments}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...patch, id, updated_at: nowIso() });
  bus.emit('request', { id, ...patch });
}

export function setStatus(id: string, status: RequestStatus, summary: string, detail?: unknown): void {
  const patch: Partial<RequestRow> = { status };
  if (status === 'completed' || status === 'rejected' || status === 'no_data') patch.completed_at = nowIso();
  updateRequest(id, patch);
  addEvent(id, status, summary, detail);
}

export function addEvent(requestId: string, type: string, summary: string, detail?: unknown): void {
  getDb().prepare('INSERT INTO request_event (request_id, type, summary, detail) VALUES (?, ?, ?, ?)')
    .run(requestId, type, summary, detail === undefined ? null : JSON.stringify(detail));
  bus.emit('event', { requestId, type, summary });
}

export function listEvents(requestId: string) {
  return getDb().prepare('SELECT id, at, type, summary, detail FROM request_event WHERE request_id = ? ORDER BY at, id').all(requestId) as {
    id: number; at: string; type: string; summary: string; detail: string | null;
  }[];
}

export function addMessage(input: {
  requestId: string;
  direction: 'out' | 'in';
  subject: string;
  from: string;
  to: string;
  body: string;
  messageId?: string;
  classification?: string;
  confidence?: number;
}): string {
  // L'utilisateur peut refuser la conservation du contenu: on garde alors les
  // métadonnées nécessaires au suivi, sans le corps du message.
  const keepBodies = getSetting('privacy').keepEmailCopies;
  const id = newId();
  getDb().prepare(`
    INSERT INTO message (id, request_id, direction, subject_enc, from_addr_enc, to_addr_enc, body_enc, message_id, classification, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.requestId,
    input.direction,
    encrypt(input.subject ?? ''),
    encrypt(input.from ?? ''),
    encrypt(input.to ?? ''),
    keepBodies ? encrypt(input.body ?? '') : null,
    input.messageId ?? null,
    input.classification ?? null,
    input.confidence ?? null,
  );
  return id;
}

export function listMessages(requestId: string) {
  const rows = getDb().prepare('SELECT * FROM message WHERE request_id = ? ORDER BY at').all(requestId) as Record<string, string | null>[];
  return rows.map((r) => ({
    id: r.id as string,
    direction: r.direction as 'in' | 'out',
    at: r.at as string,
    subject: safeDecrypt(r.subject_enc),
    from: safeDecrypt(r.from_addr_enc),
    to: safeDecrypt(r.to_addr_enc),
    body: r.body_enc ? safeDecrypt(r.body_enc) : '',
    classification: r.classification,
    confidence: r.confidence ? Number(r.confidence) : null,
  }));
}

function safeDecrypt(value: string | null): string {
  if (!value) return '';
  try {
    return decrypt(value);
  } catch {
    return '[illisible]';
  }
}

export function addArtifact(requestId: string, kind: string, file: string): void {
  if (!file) return;
  getDb().prepare('INSERT INTO artifact (request_id, kind, file) VALUES (?, ?, ?)').run(requestId, kind, file);
}

export function listArtifacts(requestId: string) {
  return getDb().prepare('SELECT id, kind, file, at FROM artifact WHERE request_id = ? ORDER BY at').all(requestId) as {
    id: number; kind: string; file: string; at: string;
  }[];
}

export interface RequestFilter {
  status?: string[];
  campaignId?: string;
  brokerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listRequests(filter: RequestFilter = {}) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map((_, i) => `@s${i}`).join(',')})`);
    filter.status.forEach((s, i) => { params[`s${i}`] = s; });
  }
  if (filter.campaignId) { where.push('campaign_id = @campaignId'); params.campaignId = filter.campaignId; }
  if (filter.brokerId) { where.push('broker_id = @brokerId'); params.brokerId = filter.brokerId; }
  if (filter.search) { where.push('broker_name LIKE @search'); params.search = `%${filter.search}%`; }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb().prepare(`
    SELECT * FROM request ${clause}
    ORDER BY CASE status WHEN 'action_required' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: filter.limit ?? 100, offset: filter.offset ?? 0 }) as RequestRow[];

  const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM request ${clause}`).get(params) as { n: number }).n;
  return { rows, total };
}

export function requestStats() {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM request GROUP BY status').all() as { status: RequestStatus; n: number }[];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<RequestStatus, number>;
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  // "Envoyée" au sens strict: le message est parti ou le formulaire a été
  // soumis. Une demande créée mais bloquée en file ne compte pas.
  const sent = (getDb().prepare('SELECT COUNT(*) AS n FROM request WHERE sent_at IS NOT NULL').get() as { n: number }).n;
  const done = (byStatus.completed ?? 0) + (byStatus.no_data ?? 0);
  const inFlight = (byStatus.queued ?? 0) + (byStatus.in_progress ?? 0) + (byStatus.sent ?? 0) + (byStatus.awaiting_reply ?? 0) + (byStatus.confirmed ?? 0);
  // Ce qui reste réellement à partir. Confondre cela avec 'en vol' affichait
  // douze demandes 'en attente d'envoi' alors que onze étaient déjà envoyées et
  // attendaient seulement une réponse: de quoi croire à des envois ratés.
  const pendingSend = (byStatus.queued ?? 0) + (byStatus.in_progress ?? 0);
  return {
    total,
    byStatus,
    sent,
    done,
    inFlight,
    pendingSend,
    actionRequired: byStatus.action_required ?? 0,
    failed: byStatus.failed ?? 0,
    rejected: byStatus.rejected ?? 0,
    progress: total ? Math.round(((done + (byStatus.rejected ?? 0)) / total) * 100) : 0,
  };
}

/** Nombre d'emails envoyés aujourd'hui, pour respecter la limite du fournisseur. */
export function emailsSentToday(): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM request
    WHERE method = 'email' AND sent_at IS NOT NULL AND date(sent_at) = date('now')
  `).get() as { n: number };
  return row.n;
}

/** Demandes déjà envoyées à un courtier, pour ne pas en renvoyer sans raison. */
export function hasOpenRequest(brokerId: string): boolean {
  const row = getDb().prepare(`
    SELECT 1 FROM request
    WHERE broker_id = ? AND status NOT IN ('failed','skipped','rejected')
    LIMIT 1
  `).get(brokerId);
  return row != null;
}

/**
 * Ce message a-t-il déjà été enregistré ?
 *
 * Le seul garde-fou fiable contre les doublons de relève: l'identifiant de
 * message est unique et stable, là où la fenêtre de recherche IMAP ne descend
 * pas sous la journée.
 */
export function messageAlreadySeen(messageId: string): boolean {
  if (!messageId) return false;
  const row = getDb().prepare('SELECT 1 FROM message WHERE message_id = ? LIMIT 1').get(messageId);
  return row != null;
}
