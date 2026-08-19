import { getDb, nowIso } from '../db/index.js';
import { decryptJson, encryptJson } from '../crypto/cipher.js';
import type {
  AutomationSettings, ImapSettings, OnboardingState, PrivacySettings, ScheduleSettings, SmtpSettings,
} from '../types.js';

/**
 * Réglages de l'application.
 *
 * Tout est chiffre, y compris les valeurs anodines: un seul chemin de code,
 * donc aucun risque d'oublier de chiffrer un mot de passe SMTP le jour ou on
 * ajoute un champ.
 */

export interface SettingsMap {
  smtp: SmtpSettings;
  imap: ImapSettings;
  automation: AutomationSettings;
  schedule: ScheduleSettings;
  privacy: PrivacySettings;
  onboarding: OnboardingState;
}

export const DEFAULTS: SettingsMap = {
  smtp: { preset: '', host: '', port: 587, secure: false, user: '', password: '', fromName: '', fromEmail: '' },
  imap: { enabled: false, host: '', port: 993, secure: true, user: '', password: '', mailbox: 'INBOX' },
  automation: {
    emailEnabled: true,
    // Active par defaut: presque toutes les machines ont deja Edge ou Chrome, et
    // chooseMethod verifie de toute facon la presence d un navigateur avant de
    // choisir une recette. Laisser cette option a false privait l utilisateur
    // d une automatisation qui ne lui coutait rien.
    webEnabled: true,
    // Gmail coupe autour de 500 messages par jour pour un compte gratuit; on
    // reste très en dessous pour ne pas déclencher de blocage anti-spam.
    dailyEmailLimit: 120,
    concurrency: 2,
    autoConfirmLinks: true,
    // Desactive par defaut: soumettre un formulaire engage l utilisateur en son
    // nom. Ceux qui veulent le zero-geste l activent, avec les garde-fous
    // decrits dans submitAutomatically.
    autoSubmitForms: false,
    captchaProvider: 'none',
    captchaKey: '',
  },
  schedule: { enabled: true, sweepEveryDays: 14, followUpAfterDays: 30, escalateAfterDays: 45 },
  privacy: {
    keepEmailCopies: true,
    catalogAutoUpdate: true,
    catalogUrl: 'https://raw.githubusercontent.com/RDSV01/RemoveBroker/main/catalog/catalog.json',
    minimalLogs: true,
  },
  onboarding: { completed: false, step: 0 },
};

export function getSetting<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  const stored = decryptJson<Partial<SettingsMap[K]>>(row?.value, {} as Partial<SettingsMap[K]>);
  // Fusion avec les valeurs par défaut: une mise à jour peut ajouter un champ
  // sans casser les installations existantes.
  return { ...DEFAULTS[key], ...stored };
}

export function setSetting<K extends keyof SettingsMap>(key: K, value: Partial<SettingsMap[K]>): SettingsMap[K] {
  const merged = { ...getSetting(key), ...value };
  getDb()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, encryptJson(merged), nowIso());
  return merged;
}

export function getAllSettings(): SettingsMap {
  return {
    smtp: getSetting('smtp'),
    imap: getSetting('imap'),
    automation: getSetting('automation'),
    schedule: getSetting('schedule'),
    privacy: getSetting('privacy'),
    onboarding: getSetting('onboarding'),
  };
}

/** Vue sans secrets, seule forme envoyée à l'interface. */
export function getRedactedSettings() {
  const s = getAllSettings();
  return {
    ...s,
    smtp: { ...s.smtp, password: s.smtp.password ? '••••••••' : '', hasPassword: Boolean(s.smtp.password) },
    imap: { ...s.imap, password: s.imap.password ? '••••••••' : '', hasPassword: Boolean(s.imap.password) },
    automation: { ...s.automation, captchaKey: s.automation.captchaKey ? '••••••••' : '' },
  };
}

/**
 * Applique une modification venant de l'interface sans effacer un secret que
 * l'utilisateur n'a pas retape (l'interface renvoie la valeur masquée).
 */
export function patchSecret<T extends object>(current: T, incoming: Partial<T>, secretKeys: (keyof T)[]): Partial<T> {
  void current;
  const out: Partial<T> = { ...incoming };
  for (const key of secretKeys) {
    const value = incoming[key];
    if (typeof value === 'string' && /^[•*]+$/.test(value)) delete out[key];
    if (value === undefined) delete out[key];
  }
  return out;
}
