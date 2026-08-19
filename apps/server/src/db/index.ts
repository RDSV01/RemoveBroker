import Database from 'better-sqlite3';
import { paths } from '../config/paths.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('db');

/**
 * Base SQLite locale unique.
 *
 * Les colonnes suffixées `_enc` contiennent du texte chiffre par crypto/cipher.
 * Le reste (identifiants de brokers, horodatages, statuts) reste en clair pour
 * que les requêtes et les statistiques fonctionnent sans déchiffrer la base
 * entière à chaque affichage.
 */

let db: Database.Database;

/** Chaque migration est appliquée une fois, dans l'ordre, via PRAGMA user_version. */
const MIGRATIONS: string[] = [
  // 1 - schema initial
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Profil de la personne dont on demande la suppression. Entierement chiffre.
  CREATE TABLE profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data_enc   TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Etat par broker: masquage, note, resultat le plus recent.
  CREATE TABLE broker_state (
    broker_id   TEXT PRIMARY KEY,
    hidden      INTEGER NOT NULL DEFAULT 0,
    last_status TEXT,
    last_action TEXT,
    note        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Brokers ajoutes a la main par l'utilisateur, fusionnes avec le catalogue.
  CREATE TABLE custom_broker (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE campaign (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    status      TEXT NOT NULL,
    options     TEXT NOT NULL,
    total       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    started_at  TEXT,
    finished_at TEXT
  );

  -- Une demande de suppression pour un broker donne.
  CREATE TABLE request (
    id             TEXT PRIMARY KEY,
    campaign_id    TEXT REFERENCES campaign(id) ON DELETE CASCADE,
    broker_id      TEXT NOT NULL,
    broker_name    TEXT NOT NULL,
    method         TEXT NOT NULL,
    status         TEXT NOT NULL,
    legal_basis    TEXT,
    token          TEXT NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at        TEXT,
    completed_at   TEXT,
    deadline_at    TEXT,
    next_action_at TEXT,
    message_id     TEXT,
    last_error     TEXT
  );
  CREATE INDEX idx_request_status   ON request(status);
  CREATE INDEX idx_request_broker   ON request(broker_id);
  CREATE INDEX idx_request_campaign ON request(campaign_id);
  CREATE INDEX idx_request_token    ON request(token);

  -- Chronologie lisible d'une demande.
  CREATE TABLE request_event (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    type       TEXT NOT NULL,
    summary    TEXT NOT NULL,
    detail     TEXT
  );
  CREATE INDEX idx_event_request ON request_event(request_id, at);

  -- Copie des emails envoyes et recus: preuve en cas de plainte a une autorite.
  CREATE TABLE message (
    id             TEXT PRIMARY KEY,
    request_id     TEXT REFERENCES request(id) ON DELETE CASCADE,
    direction      TEXT NOT NULL,
    at             TEXT NOT NULL DEFAULT (datetime('now')),
    subject_enc    TEXT,
    from_addr_enc  TEXT,
    to_addr_enc    TEXT,
    body_enc       TEXT,
    message_id     TEXT,
    classification TEXT,
    confidence     REAL
  );
  CREATE INDEX idx_message_request ON message(request_id, at);

  -- Captures d'ecran et fichiers .eml lies a une demande.
  CREATE TABLE artifact (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT REFERENCES request(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    file       TEXT NOT NULL,
    at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- File de travaux: envoi d'email, soumission de formulaire, relance, releve
  -- de la boite de reception. Persistee pour survivre a un redemarrage.
  CREATE TABLE job (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'queued',
    priority   INTEGER NOT NULL DEFAULT 100,
    run_after  TEXT NOT NULL DEFAULT (datetime('now')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_job_ready ON job(status, run_after);
  `,

  /**
   * Contacts découverts sur le site du courtier par le navigateur local.
   *
   * Le catalogue est construit par un robot que beaucoup de sites bloquent.
   * Quand une demande n'a ni adresse ni formulaire connus, l'application va
   * lire la page elle-même, avec un vrai navigateur, et retient ce qu'elle
   * trouve pour ne pas recommencer à chaque campagne.
   */
  `
  CREATE TABLE broker_contact (
    broker_id   TEXT PRIMARY KEY,
    email       TEXT,
    opt_out_url TEXT,
    source_url  TEXT,
    found_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export function openDatabase(): Database.Database {
  db = new Database(paths.database);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    log.info('application de la migration', { version: i + 1 });
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Base non ouverte');
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Ajouté des jours à une date ISO, pour les délais légaux (30 ou 45 jours). */
export function addDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
