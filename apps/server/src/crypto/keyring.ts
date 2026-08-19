import crypto from 'node:crypto';
import fs from 'node:fs';
import { paths } from '../config/paths.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('keyring');

/**
 * Gestion de la clé maîtresse utilisée pour chiffrer les données sensibles
 * (profil, mots de passe SMTP/IMAP, contenu des emails).
 *
 * Trois modes, du plus simple au plus sur:
 *
 *   plain       la clé est un fichier a permissions 0600 dans le dossier de
 *               données. Zero friction: l'application démarre seule. Protégé
 *               contre la lecture par un autre compte, pas contre quelqu'un
 *               qui a déjà accès à votre session.
 *   os          la clé est scellée par le système (DPAPI sous Windows,
 *               Trousseau sous macOS, portefeuille sous Linux) via Electron.
 *               C'est le mode par défaut de l'application de bureau.
 *   passphrase  la clé est scellée par une phrase secrète dérivée en scrypt.
 *               L'application demande la phrase à chaque démarrage.
 *
 * Le passage d'un mode a l'autre rechiffré uniquement l'enveloppe, jamais la
 * base: la clé maîtresse ne change pas.
 */

export type KeyMode = 'plain' | 'os' | 'passphrase';

interface Envelope {
  v: 1;
  mode: KeyMode;
  /** mode plain: clé en clair. mode os/passphrase: clé scellée. */
  key: string;
  salt?: string;
  nonce?: string;
  tag?: string;
  createdAt: string;
}

/** Fourni par l'enveloppe de bureau Electron (safeStorage). */
export interface OsSealer {
  seal(plain: Buffer): Buffer;
  unseal(sealed: Buffer): Buffer;
}

let osSealer: OsSealer | null = null;
let masterKey: Buffer | null = null;

export function registerOsSealer(sealer: OsSealer): void {
  osSealer = sealer;
}

export function isOsSealerAvailable(): boolean {
  return osSealer != null;
}

function readEnvelope(): Envelope | null {
  try {
    return JSON.parse(fs.readFileSync(paths.keyFile, 'utf8')) as Envelope;
  } catch {
    return null;
  }
}

function writeEnvelope(env: Envelope): void {
  fs.writeFileSync(paths.keyFile, JSON.stringify(env, null, 2), { mode: 0o600 });
}

function deriveFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  // scrypt avec des paramètrès volontairement coûteux: la phrase secrète d'un
  // humain est le maillon faible, il faut rendre l'attaque hors ligne lente.
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

function sealWithKek(key: Buffer, kek: Buffer) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
  const ct = Buffer.concat([cipher.update(key), cipher.final()]);
  return { key: ct.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function openWithKek(env: Envelope, kek: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(env.nonce!, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(env.key, 'base64')), decipher.final()]);
}

/** État courant, expose à l'interface pour afficher le niveau de protection. */
export function keyringStatus(): { mode: KeyMode; unlocked: boolean; osAvailable: boolean } {
  const env = readEnvelope();
  return { mode: env?.mode ?? (osSealer ? 'os' : 'plain'), unlocked: masterKey != null, osAvailable: osSealer != null };
}

/**
 * Charge la clé maîtresse, ou la créé au premier lancement.
 * Retourne false si une phrase secrète est nécessaire et n'a pas été fournie.
 */
export function unlock(passphrase?: string): boolean {
  if (masterKey) return true;

  const envFromProcess = process.env.RB_MASTER_KEY;
  if (envFromProcess) {
    masterKey = Buffer.from(envFromProcess, 'base64');
    if (masterKey.length !== 32) throw new Error('RB_MASTER_KEY doit contenir 32 octets encodés en base64');
    return true;
  }

  let env = readEnvelope();

  if (!env) {
    // Premier lancement: on génère la clé et on la scellé au mieux de ce que
    // l'environnement propose.
    const key = crypto.randomBytes(32);
    if (osSealer) {
      env = { v: 1, mode: 'os', key: osSealer.seal(key).toString('base64'), createdAt: new Date().toISOString() };
    } else {
      env = { v: 1, mode: 'plain', key: key.toString('base64'), createdAt: new Date().toISOString() };
    }
    writeEnvelope(env);
    masterKey = key;
    log.info('clé maîtresse créée', { mode: env.mode });
    return true;
  }

  switch (env.mode) {
    case 'plain':
      masterKey = Buffer.from(env.key, 'base64');
      return true;
    case 'os': {
      if (!osSealer) {
        // Base créée par l'application de bureau puis ouverte en ligne de
        // commande: on ne peut pas desceller sans le système.
        throw new Error("Cette installation est scellée par le système d'exploitation. Ouvrez l'application de bureau, ou exportez la clé depuis Paramètres > Confidentialité.");
      }
      masterKey = osSealer.unseal(Buffer.from(env.key, 'base64'));
      return true;
    }
    case 'passphrase': {
      if (!passphrase) return false;
      try {
        masterKey = openWithKek(env, deriveFromPassphrase(passphrase, Buffer.from(env.salt!, 'base64')));
        return true;
      } catch {
        throw new Error('Phrase secrète incorrecte.');
      }
    }
  }
}

export function requireKey(): Buffer {
  if (!masterKey) throw new Error("Coffre verrouillé: clé maîtresse indisponible.");
  return masterKey;
}

export function lock(): void {
  masterKey = null;
}

/** Change le mode de protection sans toucher aux données déjà chiffrées. */
export function setMode(mode: KeyMode, passphrase?: string): void {
  const key = requireKey();
  const now = new Date().toISOString();
  let env: Envelope;

  if (mode === 'passphrase') {
    if (!passphrase || passphrase.length < 8) throw new Error('La phrase secrète doit faire au moins 8 caractères.');
    const salt = crypto.randomBytes(16);
    env = { v: 1, mode, salt: salt.toString('base64'), createdAt: now, ...sealWithKek(key, deriveFromPassphrase(passphrase, salt)) };
  } else if (mode === 'os') {
    if (!osSealer) throw new Error("Le scellement système n'est disponible que dans l'application de bureau.");
    env = { v: 1, mode, key: osSealer.seal(key).toString('base64'), createdAt: now };
  } else {
    env = { v: 1, mode: 'plain', key: key.toString('base64'), createdAt: now };
  }

  writeEnvelope(env);
  log.info('mode de protection modifié', { mode });
}

/** Export de secours, affiche une seule fois à l'utilisateur. */
export function exportKey(): string {
  return requireKey().toString('base64');
}

/**
 * Remplace la clé maîtresse par une clé neuve, dans le même mode de protection.
 *
 * Appelée à l'effacement complet. Sans elle, la clé de l'installation effacée
 * resterait sur le disque: une sauvegarde de l'ancienne base, faite avant
 * l'effacement, serait encore déchiffrable. Effacer ses données doit rendre les
 * copies antérieures inutilisables.
 */
export function rotateKey(): void {
  const previous = readEnvelope();
  const mode: KeyMode = previous?.mode === 'os' && osSealer ? 'os' : 'plain';
  const key = crypto.randomBytes(32);

  const env: Envelope = mode === 'os'
    ? { v: 1, mode, key: osSealer!.seal(key).toString('base64'), createdAt: new Date().toISOString() }
    : { v: 1, mode: 'plain', key: key.toString('base64'), createdAt: new Date().toISOString() };

  writeEnvelope(env);
  masterKey = key;
  // Le mode "phrase secrète" retombe volontairement sur "plain": l'utilisateur
  // vient de tout effacer, lui redemander sa phrase pour une base vide n'aurait
  // aucun sens. Il la redéfinira s'il repart de zéro.
  log.info('clé maîtresse renouvelée après effacement', { mode });
}
