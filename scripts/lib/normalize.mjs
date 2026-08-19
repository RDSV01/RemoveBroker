/**
 * Normalisation partagee entre le script de build du catalogue et le serveur.
 *
 * Le catalogue fusionne plusieurs sources (registre CPPA, annuaire Optery,
 * listes communautaires). Chaque source écrit les mêmes sociétés differemment
 * ("Spokeo, Inc." / "spokeo" / "https://www.spokeo.com/"), donc la clé de
 * deduplication est le domaine enregistrable et non le nom.
 */

/** Suffixes publics a deux niveaux les plus courants chez les data brokers. */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.ar', 'com.tr',
  'co.jp', 'or.jp', 'ne.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.il',
  'com.sg', 'com.hk', 'com.tw', 'com.cn', 'com.es', 'com.pl', 'com.ua',
]);

/** Domaines de messagerie mutualises: jamais utilisables comme identité de broker. */
export const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'aol.com', 'icloud.com', 'me.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'gmx.net', 'mail.com', 'yandex.ru', 'zoho.com', 'msn.com',
]);

/**
 * Extrait l'hote d'une URL même mal formee (les sources publiques contiennent
 * beaucoup de "www.exemple.com" sans protocole, ou des espaces parasites).
 */
export function hostFromUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/^["'<]+|["'>]+$/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Domaine enregistrable: "app.eu.spokeo.co.uk" -> "spokeo.co.uk". */
export function registrableDomain(hostOrUrl) {
  // Le registre californien laisse les societes declarer plusieurs sites dans
  // une seule cellule: "example.com; example.net, autre.com". On retient le
  // premier qui ressemble a un domaine, sinon on fabrique un identifiant
  // absurde du type "com; example.net".
  const first = String(hostOrUrl || '')
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .find((part) => part && (part.includes('.') || part.includes('/'))) ?? '';

  const host = first.includes('/') || first.includes(':')
    ? hostFromUrl(first)
    : first.toLowerCase().replace(/^www\./, '');
  if (!host || !host.includes('.')) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/** Domaine porte par une adresse email, hors messageries mutualisees. */
export function domainFromEmail(email) {
  const m = /@([^\s>,;]+)/.exec(String(email || ''));
  if (!m) return '';
  const d = registrableDomain(m[1]);
  return FREEMAIL_DOMAINS.has(d) ? '' : d;
}

/** Identifiant stable et lisible dans les URL: "spokeo.com" -> "spokeo-com". */
export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Nettoie une raison sociale: "SPOKEO, INC." -> "Spokeo".
 * Les registres légaux stockent la forme juridique, pas la marque; l'interface
 * doit afficher la marque.
 */
export function cleanCompanyName(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(/[,\s]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|sarl|sas|sa|bv|plc|lp|llp|pllc|holdings?|group)\.?$/i, '');
  s = s.replace(/[,\s]+(inc|llc|ltd|corp|gmbh|sarl|sas)\.?$/i, '');
  s = s.trim().replace(/[.,;]+$/, '');
  // Une chaine entierement en majuscules est illisible dans une liste: on la
  // repasse en capitalisation par mot, sauf les acronymes de 2-4 lettres.
  if (s === s.toUpperCase() && s.length > 4) {
    s = s.split(' ').map((w) => (w.length <= 4 && /^[A-Z0-9&]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
  }
  return s;
}

/** Valide grossierement une adresse email de contact. */
export function isUsableEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s)) return false;
  // Adresses connues pour rebondir ou n'accepter aucune demande.
  if (/^(no-?reply|donotreply|postmaster|abuse|mailer-daemon)@/.test(s)) return false;
  return true;
}

/** Catégorie normalisee à partir des libelles heterogenes des sources. */
export function normalizeCategory(raw) {
  const s = String(raw || '').toLowerCase();
  if (/people\s*search|profile data|reverse lookup/.test(s)) return 'people-search';
  if (/phone directory|phone/.test(s)) return 'phone-directory';
  if (/background|criminal|court/.test(s)) return 'background-check';
  if (/b2b|lead gen/.test(s)) return 'b2b';
  if (/business search|company data/.test(s)) return 'business-search';
  // La localisation revendue a la publicite est traitee a part: c'est la
  // categorie ou la cle n'est pas le nom mais l'identifiant publicitaire du
  // telephone, donc celle qui demande une demande differente.
  if (/location|geoloc|mobility|movement|places|foot ?traffic/.test(s)) return 'location';
  if (/market|advertis|adtech|audience/.test(s)) return 'marketing';
  if (/credit|risk|score/.test(s)) return 'credit-risk';
  if (/health|medical/.test(s)) return 'health';
  return 'other';
}
