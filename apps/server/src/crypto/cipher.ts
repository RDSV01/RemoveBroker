import crypto from 'node:crypto';
import { requireKey } from './keyring.js';

/**
 * Chiffrement des valeurs sensibles stockées en base.
 *
 * AES-256-GCM, nonce aléatoire par valeur, format texte compact pour tenir
 * dans une colonne SQLite TEXT:
 *
 *   rb1:<nonce base64url>:<chiffre base64url>:<tag base64url>
 *
 * Le préfixe permet de reconnaître une valeur chiffrée et de faire évoluer le
 * format plus tard sans migration destructive.
 */

const PREFIX = 'rb1';

export function encrypt(plain: string): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(), nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, nonce.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':');
}

export function decrypt(payload: string): string {
  if (!isEncrypted(payload)) return payload;
  const [, nonce, ct, tag] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX + ':') && value.split(':').length === 4;
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(payload: string | null | undefined, fallback: T): T {
  if (!payload) return fallback;
  try {
    return JSON.parse(decrypt(payload)) as T;
  } catch {
    return fallback;
  }
}

/** Empreinte stable et non réversible, utilisée pour dédupliquer sans stocker la valeur. */
export function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}
