import { getDb, nowIso } from '../db/index.js';
import { decryptJson, encryptJson } from '../crypto/cipher.js';
import type { Profile } from '../types.js';

/** Le profil est la donnée la plus sensible de l'application: toujours chiffre. */

export function getProfile(): Profile | null {
  const row = getDb().prepare('SELECT data_enc FROM profile WHERE id = 1').get() as { data_enc: string } | undefined;
  if (!row) return null;
  return decryptJson<Profile | null>(row.data_enc, null);
}

export function saveProfile(profile: Profile): Profile {
  const clean: Profile = {
    ...profile,
    firstName: profile.firstName.trim(),
    lastName: profile.lastName.trim(),
    emails: dedupe(profile.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    phones: dedupe((profile.phones ?? []).map((p) => p.trim()).filter(Boolean)),
    previousNames: dedupe((profile.previousNames ?? []).map((n) => n.trim()).filter(Boolean)),
    addresses: (profile.addresses ?? []).filter((a) => a.city || a.zip || a.line1),
    // Les identifiants publicitaires sont des UUID: on retire les espaces et on
    // uniformise la casse, sinon deux copies de la même valeur cohabiteraient.
    advertisingIds: dedupe(
      (profile.advertisingIds ?? [])
        .map((id) => id.trim().toLowerCase())
        .filter((id) => /^[0-9a-f-]{16,80}$/.test(id)),
    ),
  };
  getDb()
    .prepare('INSERT INTO profile (id, data_enc, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_enc = excluded.data_enc, updated_at = excluded.updated_at')
    .run(encryptJson(clean), nowIso());
  return clean;
}

export function requireProfile(): Profile {
  const p = getProfile();
  if (!p) throw new Error("Aucun profil enregistré. Terminez la configuration initiale.");
  return p;
}

/** Fondement juridique a invoquer selon le lieu de résidence déclare. */
export function legalBasisFor(profile: Profile): 'gdpr' | 'ukgdpr' | 'generic' {
  switch (profile.jurisdiction) {
    case 'eu': return 'gdpr';
    case 'uk': return 'ukgdpr';
    default: return 'generic';
  }
}

/** Valeurs injectées dans les gabarits d'email et les recettes de formulaire. */
export function templateVariables(profile: Profile): Record<string, string> {
  const address = profile.addresses[0];
  const full = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ');
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    middleName: profile.middleName ?? '',
    fullName: full,
    email: profile.emails[0] ?? '',
    allEmails: profile.emails.join(', '),
    phone: profile.phones?.[0] ?? '',
    allPhones: (profile.phones ?? []).join(', '),
    address: address ? [address.line1, address.line2].filter(Boolean).join(', ') : '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    stateCode: (address?.state ?? '').slice(0, 2).toUpperCase(),
    zip: address?.zip ?? '',
    country: address?.country ?? '',
    fullAddress: address ? [address.line1, address.line2, address.zip, address.city, address.country].filter(Boolean).join(', ') : '',
    dob: profile.dateOfBirth ?? '',
    previousNames: (profile.previousNames ?? []).join(', '),
    // Identifiant publicitaire du téléphone. Chez un courtier de localisation,
    // c'est la seule clé qui permette de retrouver quoi que ce soit: le nom et
    // l'adresse ne figurent nulle part dans leurs bases.
    advertisingId: profile.advertisingIds?.[0] ?? '',
    allAdvertisingIds: (profile.advertisingIds ?? []).join(', '),
    date: new Date().toLocaleDateString(profile.language === 'fr' ? 'fr-FR' : 'en-GB'),
  };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
