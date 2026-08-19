/**
 * Réglages serveur des fournisseurs de messagerie courants.
 *
 * L'utilisateur ne doit jamais avoir a chercher un numéro de port. Il saisit
 * son adresse, l'application déduit le reste et n'affiche les champs avancés
 * que si la détection échoué.
 */

export interface Provider {
  id: string;
  label: string;
  domains: string[];
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number; secure: boolean };
  /** Mot de passe d'application obligatoire (authentification a deux facteurs). */
  appPassword?: { required: boolean; url: string; help: string };
  note?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    appPassword: {
      required: true,
      url: 'https://myaccount.google.com/apppasswords',
      help: "Google refuse le mot de passe habituel. Activez la validation en deux étapes, puis créez un mot de passe d'application de 16 caractères et collez-le ici.",
    },
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail / Live',
    domains: ['outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com'],
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    appPassword: {
      required: true,
      url: 'https://account.live.com/proofs/AppPassword',
      help: "Microsoft exige un mot de passe d'application lorsque la vérification en deux étapes est active.",
    },
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.fr', 'ymail.com'],
    smtp: { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    appPassword: { required: true, url: 'https://login.yahoo.com/account/security', help: "Yahoo impose un mot de passe d'application." },
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    appPassword: { required: true, url: 'https://account.apple.com/account/manage', help: "Apple impose un mot de passe pour application." },
  },
  {
    id: 'ovh',
    label: 'OVH',
    domains: ['ovh.net', 'ovh.com'],
    smtp: { host: 'ssl0.ovh.net', port: 587, secure: false },
    imap: { host: 'ssl0.ovh.net', port: 993, secure: true },
  },
  {
    id: 'free',
    label: 'Free',
    domains: ['free.fr'],
    smtp: { host: 'smtp.free.fr', port: 587, secure: false },
    imap: { host: 'imap.free.fr', port: 993, secure: true },
  },
  {
    id: 'orange',
    label: 'Orange / Wanadoo',
    domains: ['orange.fr', 'wanadoo.fr'],
    smtp: { host: 'smtp.orange.fr', port: 465, secure: true },
    imap: { host: 'imap.orange.fr', port: 993, secure: true },
  },
  {
    id: 'sfr',
    label: 'SFR',
    domains: ['sfr.fr', 'neuf.fr'],
    smtp: { host: 'smtp.sfr.fr', port: 465, secure: true },
    imap: { host: 'imap.sfr.fr', port: 993, secure: true },
  },
  {
    id: 'laposte',
    label: 'La Poste',
    domains: ['laposte.net'],
    smtp: { host: 'smtp.laposte.net', port: 465, secure: true },
    imap: { host: 'imap.laposte.net', port: 993, secure: true },
  },
  {
    id: 'gmx',
    label: 'GMX',
    domains: ['gmx.com', 'gmx.net', 'gmx.fr', 'gmx.de'],
    smtp: { host: 'mail.gmx.com', port: 587, secure: false },
    imap: { host: 'imap.gmx.com', port: 993, secure: true },
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    domains: ['zoho.com', 'zohomail.com'],
    smtp: { host: 'smtp.zoho.com', port: 587, secure: false },
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    appPassword: { required: true, url: 'https://accounts.zoho.com/home#security/security_pwd', help: "Zoho impose un mot de passe spécifique application." },
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm'],
    smtp: { host: 'smtp.fastmail.com', port: 587, secure: false },
    imap: { host: 'imap.fastmail.com', port: 993, secure: true },
    appPassword: { required: true, url: 'https://app.fastmail.com/settings/security/apps', help: 'Fastmail impose un mot de passe application.' },
  },
  {
    id: 'proton',
    label: 'Proton Mail (via Proton Mail Bridge)',
    domains: ['proton.me', 'protonmail.com', 'pm.me'],
    smtp: { host: '127.0.0.1', port: 1025, secure: false },
    imap: { host: '127.0.0.1', port: 1143, secure: false },
    note: "Proton n'expose pas de SMTP public. Installez Proton Mail Bridge (offre payante) et gardez-le ouvert pendant les campagnes.",
  },
];

export function detectProvider(email: string): Provider | undefined {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;
  return PROVIDERS.find((p) => p.domains.includes(domain));
}

/** Réglages proposés pour un domaine inconnu: convention la plus répandue. */
export function guessSettings(email: string) {
  const known = detectProvider(email);
  if (known) return { provider: known.id, smtp: known.smtp, imap: known.imap };
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return {
    provider: 'custom',
    smtp: { host: domain ? `smtp.${domain}` : '', port: 587, secure: false },
    imap: { host: domain ? `imap.${domain}` : '', port: 993, secure: true },
  };
}

/**
 * Adresse de réponse avec sous-adressage, quand le fournisseur le supporte.
 * Une réponse arrivant sur user+rb.TOKEN@... se rattache seule à sa demande.
 */
export function plusAddress(email: string, token: string): string | undefined {
  const [local, domain] = email.split('@');
  if (!local || !domain) return undefined;
  const supports = ['gmail.com', 'googlemail.com', 'fastmail.com', 'proton.me', 'protonmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'zoho.com'];
  if (!supports.includes(domain.toLowerCase())) return undefined;
  if (local.includes('+')) return undefined;
  return `${local}+rb.${token}@${domain}`;
}
