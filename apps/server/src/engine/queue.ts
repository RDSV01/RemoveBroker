import { getDb, nowIso } from '../db/index.js';
import { createLogger } from '../util/logger.js';
import { bus } from './bus.js';

const log = createLogger('queue');

/**
 * File de travaux persistée en base.
 *
 * Une campagne peut durer plusieurs jours: envoyer une centaine d'emails,
 * attendre les réponses, relancer. Garder la file en mémoire signifierait tout
 * perdre à la fermeture de l'application. Ici, un travail interrompu reprend
 * au démarrage suivant.
 */

export type JobKind = 'send_email' | 'run_recipe' | 'poll_inbox' | 'follow_up' | 'catalog_update' | 'confirm_link' | 'discover_contact' | 'submit_form';

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
}

type Handler = (job: Job) => Promise<void>;

const handlers = new Map<JobKind, Handler>();
const MAX_ATTEMPTS: Record<JobKind, number> = {
  send_email: 3,
  run_recipe: 2,
  poll_inbox: 2,
  follow_up: 3,
  catalog_update: 2,
  confirm_link: 2,
  // Une seule reprise: si le site ne repond pas deux fois, insister ne sert a
  // rien et retarde les autres demandes.
  discover_contact: 2,
  submit_form: 2,
};

/**
 * Délai au-delà duquel un travail est considéré perdu.
 *
 * Les opérations Playwright ont chacune leur propre délai, mais pas le
 * lancement du navigateur ni le travail dans son ensemble. Un blocage à ce
 * niveau immobilisait un emplacement d'exécution définitivement, réduisant la
 * concurrence sans qu'aucune erreur n'apparaisse. Observé le 19 août 2026:
 * quatre demandes figées en `in_progress` pendant cinq heures.
 */
let jobTimeoutMs = 5 * 60_000;

/**
 * Raccourcit le délai, le temps d'un test.
 *
 * Éprouver un abandon de cinq minutes autrement supposerait d'attendre cinq
 * minutes, ou de ne pas l'éprouver du tout.
 */
export function setJobTimeoutForTest(ms: number): void {
  jobTimeoutMs = ms;
}

let running = false;
let paused = false;
let inFlight = 0;
let concurrency = 2;
let timer: NodeJS.Timeout | null = null;

/** Abandonne le travail passé le délai, pour libérer l'emplacement. */
async function withTimeout(promise: Promise<void>, kind: JobKind): Promise<void> {
  let watchdog: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error(`travail ${kind} abandonné après ${jobTimeoutMs / 1000} s`)),
          jobTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}

/**
 * Exécute un travail immédiatement, hors file.
 *
 * Réservé aux vérifications: certains chemins ne se déclenchent qu'après des
 * semaines, comme la relance à trente jours. Les éprouver suppose de pouvoir
 * les appeler sans attendre.
 */
export async function runHandlerForTest(kind: JobKind, payload: Record<string, unknown>): Promise<void> {
  const handler = handlers.get(kind);
  if (!handler) throw new Error(`aucun gestionnaire pour ${kind}`);
  await handler({ id: 0, kind, payload, attempts: 0 });
}

export function registerHandler(kind: JobKind, handler: Handler): void {
  handlers.set(kind, handler);
}

export function setConcurrency(value: number): void {
  concurrency = Math.max(1, Math.min(8, value));
}

export interface EnqueueOptions {
  runAfter?: string;
  priority?: number;
  /** Empêche les doublons: un seul travail de ce type pour cette clé. */
  dedupeKey?: string;
}

export function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, options: EnqueueOptions = {}): number | null {
  if (options.dedupeKey) {
    const existing = getDb().prepare(`
      SELECT id FROM job WHERE kind = ? AND status IN ('queued','running') AND json_extract(payload, '$.dedupeKey') = ?
    `).get(kind, options.dedupeKey) as { id: number } | undefined;
    if (existing) return null;
  }
  const body = { ...payload, ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}) };
  const info = getDb().prepare('INSERT INTO job (kind, payload, priority, run_after) VALUES (?, ?, ?, ?)')
    .run(kind, JSON.stringify(body), options.priority ?? 100, options.runAfter ?? nowIso());
  return Number(info.lastInsertRowid);
}

function claimNext(): Job | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, kind, payload, attempts FROM job
    WHERE status = 'queued' AND run_after <= ?
    ORDER BY priority, id LIMIT 1
  `).get(nowIso()) as { id: number; kind: JobKind; payload: string; attempts: number } | undefined;
  if (!row) return null;

  const claimed = db.prepare("UPDATE job SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), row.id);
  if (claimed.changes === 0) return null;

  return { id: row.id, kind: row.kind, payload: JSON.parse(row.payload), attempts: row.attempts };
}

/**
 * Clôture un travail, sauf s'il s'est lui-même replanifié.
 *
 * Un gestionnaire peut décider de reporter son travail plutôt que de l'exécuter
 * (limite quotidienne d'envoi atteinte, par exemple): il remet alors la ligne en
 * `queued` avec une nouvelle date. La clôture doit respecter cette décision,
 * d'où la condition `status = 'running'`: elle n'écrit que si personne n'a
 * touché à la ligne entre-temps.
 *
 * Sans cette condition, la clôture écrasait la reprogrammation en `done` et le
 * travail disparaissait sans avoir eu lieu. Observé le 20 août 2026: 1 429
 * demandes reportées à cause de la limite quotidienne, dont l'email n'est
 * jamais parti et que plus aucun travail ne reprenait.
 */
function finish(job: Job, error?: Error): void {
  const db = getDb();
  if (!error) {
    const closed = db.prepare("UPDATE job SET status = 'done', updated_at = ? WHERE id = ? AND status = 'running'")
      .run(nowIso(), job.id);
    if (closed.changes === 0) {
      bus.emit('job', { id: job.id, kind: job.kind, status: 'deferred' });
      return;
    }
    bus.emit('job', { id: job.id, kind: job.kind, status: 'done' });
    return;
  }

  const attempts = job.attempts + 1;
  const max = MAX_ATTEMPTS[job.kind] ?? 3;
  if (attempts >= max) {
    const closed = db.prepare("UPDATE job SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(attempts, error.message.slice(0, 500), nowIso(), job.id);
    if (closed.changes === 0) return;
    log.warn('travail abandonné', { kind: job.kind, tentatives: attempts });
    bus.emit('job', { id: job.id, kind: job.kind, status: 'failed' });
    return;
  }

  // Report exponentiel: un courtier qui répond mal à une requête répondra
  // rarement mieux à la suivante lancée dans la seconde.
  const delayMinutes = Math.min(60, 2 ** attempts);
  const runAfter = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  const closed = db.prepare("UPDATE job SET status = 'queued', attempts = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ? AND status = 'running'")
    .run(attempts, error.message.slice(0, 500), runAfter, nowIso(), job.id);
  if (closed.changes === 0) return;
  bus.emit('job', { id: job.id, kind: job.kind, status: 'retry', attempts });
}

/** Identifiants de demandes ayant encore un travail en file ou en cours. */
export function requestIdsWithPendingJob(): Set<string> {
  const rows = getDb().prepare(`
    SELECT DISTINCT json_extract(payload, '$.requestId') AS requestId
    FROM job WHERE status IN ('queued','running')
  `).all() as { requestId: string | null }[];
  return new Set(rows.map((r) => r.requestId).filter((id): id is string => Boolean(id)));
}

async function tick(): Promise<void> {
  if (paused) return;
  while (inFlight < concurrency) {
    const job = claimNext();
    if (!job) break;

    const handler = handlers.get(job.kind);
    if (!handler) {
      finish(job, new Error(`aucun gestionnaire pour ${job.kind}`));
      continue;
    }

    inFlight++;
    bus.emit('job', { id: job.id, kind: job.kind, status: 'running' });
    withTimeout(handler(job), job.kind)
      .then(() => finish(job))
      .catch((err: Error) => finish(job, err))
      .finally(() => { inFlight--; });
  }
}

export function startQueue(): void {
  if (running) return;
  running = true;
  // Un travail interrompu par une fermeture brutale reste "running" en base:
  // on le remet en file au démarrage.
  getDb().prepare("UPDATE job SET status = 'queued' WHERE status = 'running'").run();
  // Sa demande, elle, restait bloquée en "in_progress" sans que rien ne la
  // reprenne: ni envoyée, ni en échec, invisible pour toute relance. Elle
  // repart en file, l'envoi n'ayant par définition pas eu lieu.
  const reprises = getDb()
    .prepare("UPDATE request SET status = 'queued', updated_at = ? WHERE status = 'in_progress' AND sent_at IS NULL")
    .run(nowIso()).changes;
  if (reprises) log.info('demandes interrompues remises en file', { nombre: reprises });
  timer = setInterval(() => { void tick(); }, 1000);
  log.info('file démarrée', { concurrence: concurrency });
}

export function stopQueue(): void {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export function pauseQueue(): void {
  paused = true;
  bus.emit('job', { status: 'paused' });
}

export function resumeQueue(): void {
  paused = false;
  bus.emit('job', { status: 'resumed' });
}

export function queueStatus() {
  const rows = getDb().prepare("SELECT status, COUNT(*) AS n FROM job GROUP BY status").all() as { status: string; n: number }[];
  return {
    paused,
    inFlight,
    concurrency,
    counts: Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>,
  };
}

/** Supprime les travaux terminés de plus de 7 jours pour garder la base compacte. */
export function pruneJobs(): void {
  getDb().prepare("DELETE FROM job WHERE status IN ('done','failed') AND updated_at < datetime('now','-7 days')").run();
}
