/// <reference lib="dom" />
// La lecture de page s'exécute dans le navigateur: sans cette référence,
// `document` n'existe pas à la compilation côté Node.

import { launchContext } from './browser.js';
import { getDb } from '../db/index.js';
import { applyDiscoveredContact } from '../core/catalog.js';
import { createLogger } from '../util/logger.js';
import type { Broker } from '../types.js';

const log = createLogger('discover');

/**
 * Découverte du contact d'un courtier avec le navigateur local.
 *
 * Le catalogue est construit en intégration continue par un robot qui se
 * présente honnêtement, et que beaucoup de sites refusent pour cette raison:
 * 79 des courtiers examinés répondent « interdit aux robots ». Leur page
 * contient pourtant l'adresse imposée par l'article 13 du RGPD.
 *
 * L'application dispose déjà d'un vrai navigateur pour remplir les formulaires.
 * Elle s'en sert donc pour lire cette page elle-même, récupérer l'adresse ou le
 * lien vers le portail de demande, et poursuivre sans rien demander à
 * l'utilisateur. Il n'est sollicité que si rien n'est trouvé.
 */

export interface DiscoveredContact {
  email?: string;
  optOutUrl?: string;
  sourceUrl?: string;
}

/** Chemins où une politique de confidentialité se trouve presque toujours. */
const PATHS = [
  '/privacy', '/privacy-policy', '/privacy-notice', '/legal/privacy',
  '/politique-de-confidentialite', '/confidentialite', '/mentions-legales',
  '/datenschutz', '/legal', '/gdpr', '/',
];

/**
 * Temps maximum consacré à un courtier.
 *
 * Onze chemins à vingt secondes chacun font près de quatre minutes sur un site
 * lent, pour un seul courtier, alors que deux recherches tournent à la fois.
 * Mesuré le 20 août 2026: cinquante minutes pour douze courtiers. Les adresses
 * utiles se trouvent sur les premières pages ou nulle part; au-delà, on occupe
 * un emplacement d'exécution sans rien produire, et les autres demandes
 * attendent. La recherche rend ce qu'elle a trouvé et s'arrête.
 */
const BUDGET_MS = 45_000;

/** Délai par page: au-delà, la page ne répondra pas mieux en insistant. */
const PAGE_TIMEOUT_MS = 12_000;

const PRIVACY_LOCAL = /^(dpo|dpd|dsr|datenschutz|dataprotection|data-protection|privacy|privacidad|rgpd|gdpr|ccpa|delegue)/i;
const PLACEHOLDER = /^(john|jane)[._-]?doe$|^(exemple|example|test|user|email)$/i;
const SHARED_OPTOUT = /(tools\.google\.com|aboutads\.info|youronlinechoices|networkadvertising\.org|youradchoices|adssettings\.google)/i;
const DSAR_PLATFORM = /(onetrust|trustarc|securiti|osano|ketch|transcend|didomi|usercentrics|privacyportal|submit-irm|dsar)/i;
const RIGHTS_LINK = /(opt[\s-]?out|do[\s-]?not[\s-]?sell|privacy[\s-]?(request|center|centre|choices)|data[\s-]?(request|subject)|dsar|deletion[\s-]?request|erasure|submit[\s-]?a[\s-]?request|exercer[\s-]?vos[\s-]?droits|mes[\s-]?droits)/i;

/**
 * Une recherche infructueuse n'est valable qu'un temps.
 *
 * Le résultat vide était mémorisé sans date d'expiration: 88 courtiers sur 136
 * étaient ainsi marqués « rien trouvé » pour toujours, et aucune campagne
 * ultérieure ne relisait leur site, même après refonte ou publication d'une
 * adresse. Un mois est assez long pour ne pas relire un site chaque semaine, et
 * assez court pour rattraper un changement.
 */
const OUBLI_ECHEC_JOURS = 30;

/** Contact déjà découvert pour ce courtier, s'il y en a un. */
export function knownContact(brokerId: string): DiscoveredContact | null {
  const row = getDb()
    .prepare('SELECT email, opt_out_url, source_url, found_at, dead FROM broker_contact WHERE broker_id = ?')
    .get(brokerId) as { email: string | null; opt_out_url: string | null; source_url: string | null; found_at: string; dead: number } | undefined;
  if (!row) return null;
  // Adresse morte: il faut justement en chercher une autre, tout de suite.
  if (row.dead === 1) return null;
  if (!row.email && !row.opt_out_url) {
    const age = Date.now() - new Date(`${row.found_at.replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(age) || age > OUBLI_ECHEC_JOURS * 86_400_000) return null;
  }
  return {
    email: row.email ?? undefined,
    optOutUrl: row.opt_out_url ?? undefined,
    sourceUrl: row.source_url ?? undefined,
  };
}

/** L'adresse connue de ce courtier a-t-elle rebondi ? */
export function isContactDead(brokerId: string): boolean {
  const row = getDb().prepare('SELECT dead FROM broker_contact WHERE broker_id = ?').get(brokerId) as { dead: number } | undefined;
  return row?.dead === 1;
}

/**
 * Marque l'adresse d'un courtier comme morte, après un rebond confirmé.
 *
 * Ni oubli ni suppression: c'est une information acquise, et elle doit survivre
 * au redémarrage. Le courtier redevient « sans contact » pour cette
 * installation, ce qui relance la lecture de son site au lieu de réécrire à un
 * destinataire dont on sait qu'il n'existe pas.
 */
export function forgetDiscoveredContact(brokerId: string): void {
  getDb()
    .prepare(`INSERT INTO broker_contact (broker_id, email, opt_out_url, source_url, found_at, dead)
              VALUES (?, NULL, NULL, NULL, datetime('now'), 1)
              ON CONFLICT(broker_id) DO UPDATE SET
                email = NULL, opt_out_url = NULL, dead = 1, found_at = datetime('now')`)
    .run(brokerId);
  applyDiscoveredContact(brokerId, { dead: true });
}

function remember(brokerId: string, contact: DiscoveredContact): void {
  getDb()
    .prepare(`INSERT INTO broker_contact (broker_id, email, opt_out_url, source_url, found_at, dead)
              VALUES (?, ?, ?, ?, datetime('now'), 0)
              ON CONFLICT(broker_id) DO UPDATE SET
                email = excluded.email, opt_out_url = excluded.opt_out_url,
                source_url = excluded.source_url, found_at = datetime('now'), dead = 0`)
    .run(brokerId, contact.email ?? null, contact.optOutUrl ?? null, contact.sourceUrl ?? null);
  // Le catalogue en mémoire doit connaître ce contact immédiatement: c'est lui
  // que l'envoi consultera dans la seconde qui suit.
  applyDiscoveredContact(brokerId, { email: contact.email, optOutUrl: contact.optOutUrl });
}

/**
 * Lit une page et en extrait le contact.
 *
 * L'analyse se fait dans le navigateur, sur le DOM rendu: beaucoup de sites
 * n'écrivent leur adresse qu'après exécution de leur JavaScript, ce qu'un
 * simple téléchargement du HTML ne verrait jamais.
 */
async function readPage(page: { evaluate: <T>(fn: (arg: unknown) => T, arg: unknown) => Promise<T> }, patterns: {
  domain: string; privacyLocal: string; placeholder: string; shared: string; platform: string; rights: string;
}) {
  return page.evaluate((raw) => {
    const p = raw as { domain: string; privacyLocal: string; placeholder: string; shared: string; platform: string; rights: string };
    const privacyLocal = new RegExp(p.privacyLocal, 'i');
    const placeholder = new RegExp(p.placeholder, 'i');
    const shared = new RegExp(p.shared, 'i');
    const platform = new RegExp(p.platform, 'i');
    const rights = new RegExp(p.rights, 'i');
    const brand = p.domain.split('.')[0];

    // --- adresses ----------------------------------------------------------
    // Une page peut être remplacée en pleine lecture (redirection, cadre
    // détruit): `documentElement` vaut alors null et l'accès direct faisait
    // échouer la recherche entière avec « Cannot read properties of null ».
    const html = document.documentElement?.innerHTML ?? '';
    const text = document.body?.innerText ?? '';
    const candidates = new Map<string, number>();

    const consider = (raw2: string) => {
      const email = raw2.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return;
      const [local, host] = email.split('@');
      if (placeholder.test(local)) return;
      if (/^(no-?reply|donotreply|postmaster|abuse)/i.test(local)) return;

      const sameHouse = host.includes(brand) || host.endsWith(p.domain);
      if (!sameHouse && !privacyLocal.test(local)) return;

      let score = 1;
      if (/^(dpo|dpd|datenschutz|privacy|rgpd|gdpr|dataprotection|delegue)/i.test(local)) score = 5;
      else if (/(privacy|rgpd|gdpr|dpo|donnees|datenschutz)/i.test(local)) score = 4;
      else if (/^(legal|compliance|juridique)/i.test(local)) score = 3;
      else if (/^(contact|info|hello|support)/i.test(local)) score = 2;
      candidates.set(email, Math.max(candidates.get(email) ?? 0, sameHouse ? score : score - 1));
    };

    for (const m of html.matchAll(/mailto:([^"'<>\s)]+)/gi)) consider(m[1]);
    for (const m of text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) consider(m[0]);

    // Adresses écrites en toutes lettres contre les robots: « dpo [at] x [dot]
    // com », « dpo ((at)) x ((dot)) com ». Sans cela, des courtiers qui
    // publient bien un contact passaient pour n'en avoir aucun.
    const at = String.raw`\s*(?:\[at\]|\(at\)|\(\(at\)\)|&#64;|\bat\b)\s*`;
    const dot = String.raw`\s*(?:\[dot\]|\(dot\)|\(\(dot\)\)|\bdot\b|\bpoint\b)\s*`;
    const obfusque = new RegExp(
      String.raw`([\w.+-]+)${at}([\w-]+)(?:${dot}|\.)([\w-]+)(?:(?:${dot}|\.)([a-z]{2,}))?`,
      'gi',
    );
    for (const m of text.matchAll(obfusque)) {
      consider(`${m[1]}@${[m[2], m[3], m[4]].filter(Boolean).join('.')}`);
    }

    const best = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];

    // --- lien vers le portail de demande -----------------------------------
    let optOutUrl: string | undefined;
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = (a as HTMLAnchorElement).href;
      const label = a.textContent ?? '';
      if (!rights.test(href) && !rights.test(label)) continue;
      if (/privacy-?policy|politique-de-confidentialite|privacy-?notice|\/terms/i.test(href)) continue;
      if (href.split('#')[0] === location.href.split('#')[0]) continue;
      let host = '';
      try { host = new URL(href).hostname; } catch { continue; }
      if (shared.test(host)) continue;
      if (!host.includes(brand) && !platform.test(href)) continue;
      optOutUrl = href;
      break;
    }

    return { email: best?.[0], optOutUrl, sourceUrl: location.href };
  }, patterns);
}

/**
 * Cherche un moyen de contact pour ce courtier, avec le navigateur local.
 * Retourne ce qu'il a trouvé, et le mémorise pour les campagnes suivantes.
 */
export async function discoverContact(broker: Broker): Promise<DiscoveredContact> {
  const cached = knownContact(broker.id);
  if (cached) return cached;

  const origin = broker.website?.startsWith('http')
    ? new URL(broker.website).origin
    : broker.domain ? `https://${broker.domain}` : null;
  if (!origin) return {};

  const patterns = {
    domain: broker.domain ?? '',
    privacyLocal: PRIVACY_LOCAL.source,
    placeholder: PLACEHOLDER.source,
    shared: SHARED_OPTOUT.source,
    platform: DSAR_PLATFORM.source,
    rights: RIGHTS_LINK.source,
  };

  /**
   * L'adresse de la politique déclarée par la société vient en premier.
   *
   * C'est elle que le courtier publie lui-même, dans la liste des fournisseurs
   * du cadre de consentement européen notamment. Elle est parfois périmée, mais
   * elle ne coûte qu'un chargement de page et évite de deviner un chemin.
   */
  const candidates = [...new Set([
    ...(broker.privacyUrl ? [broker.privacyUrl] : []),
    ...PATHS.map((p) => origin + p),
  ])];

  const { browser, context } = await launchContext({ headed: false, locale: 'fr-FR' });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  const echeance = Date.now() + BUDGET_MS;

  const found: DiscoveredContact = {};
  try {
    for (const url of candidates) {
      if (Date.now() > echeance) {
        log.debug('budget de recherche épuisé', { broker: broker.id });
        break;
      }
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        if (!response || response.status() >= 400) continue;
        // Laisser le JavaScript écrire ce qu'il a à écrire.
        await page.waitForTimeout(1200);
      } catch {
        continue;
      }

      // Une page qui navigue pendant l'analyse détruit le contexte
      // d'exécution. C'est un incident de cette page, pas de la recherche:
      // sans ce filet, une seule redirection tardive faisait échouer les onze
      // chemins restants et laissait la demande figée.
      let result: Awaited<ReturnType<typeof readPage>>;
      try {
        result = await readPage(page as never, patterns);
      } catch (err) {
        log.debug('lecture de page abandonnée', { broker: broker.id, url, raison: String((err as Error).message) });
        continue;
      }

      if (result.email && !found.email) { found.email = result.email; found.sourceUrl = result.sourceUrl; }
      if (result.optOutUrl && !found.optOutUrl) found.optOutUrl = result.optOutUrl;
      // Une adresse dédiée suffit: inutile de continuer à visiter le site.
      if (found.email) break;
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  remember(broker.id, found);
  log.info('découverte de contact', {
    broker: broker.id,
    email: found.email ? 'trouvée' : 'aucune',
    portail: found.optOutUrl ? 'trouvé' : 'aucun',
  });
  return found;
}
