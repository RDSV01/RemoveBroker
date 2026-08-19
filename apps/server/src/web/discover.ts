/// <reference lib="dom" />
// La lecture de page s'exécute dans le navigateur: sans cette référence,
// `document` n'existe pas à la compilation côté Node.

import { launchContext } from './browser.js';
import { getDb } from '../db/index.js';
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

const PRIVACY_LOCAL = /^(dpo|dpd|dsr|datenschutz|dataprotection|data-protection|privacy|privacidad|rgpd|gdpr|ccpa|delegue)/i;
const PLACEHOLDER = /^(john|jane)[._-]?doe$|^(exemple|example|test|user|email)$/i;
const SHARED_OPTOUT = /(tools\.google\.com|aboutads\.info|youronlinechoices|networkadvertising\.org|youradchoices|adssettings\.google)/i;
const DSAR_PLATFORM = /(onetrust|trustarc|securiti|osano|ketch|transcend|didomi|usercentrics|privacyportal|submit-irm|dsar)/i;
const RIGHTS_LINK = /(opt[\s-]?out|do[\s-]?not[\s-]?sell|privacy[\s-]?(request|center|centre|choices)|data[\s-]?(request|subject)|dsar|deletion[\s-]?request|erasure|submit[\s-]?a[\s-]?request|exercer[\s-]?vos[\s-]?droits|mes[\s-]?droits)/i;

/** Contact déjà découvert pour ce courtier, s'il y en a un. */
export function knownContact(brokerId: string): DiscoveredContact | null {
  const row = getDb()
    .prepare('SELECT email, opt_out_url, source_url FROM broker_contact WHERE broker_id = ?')
    .get(brokerId) as { email: string | null; opt_out_url: string | null; source_url: string | null } | undefined;
  if (!row) return null;
  return {
    email: row.email ?? undefined,
    optOutUrl: row.opt_out_url ?? undefined,
    sourceUrl: row.source_url ?? undefined,
  };
}

function remember(brokerId: string, contact: DiscoveredContact): void {
  getDb()
    .prepare(`INSERT INTO broker_contact (broker_id, email, opt_out_url, source_url)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(broker_id) DO UPDATE SET
                email = excluded.email, opt_out_url = excluded.opt_out_url,
                source_url = excluded.source_url, found_at = datetime('now')`)
    .run(brokerId, contact.email ?? null, contact.optOutUrl ?? null, contact.sourceUrl ?? null);
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
    const html = document.documentElement.innerHTML;
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

  const { browser, context } = await launchContext({ headed: false, locale: 'fr-FR' });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const found: DiscoveredContact = {};
  try {
    for (const path of PATHS) {
      try {
        const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        if (!response || response.status() >= 400) continue;
        // Laisser le JavaScript écrire ce qu'il a à écrire.
        await page.waitForTimeout(1200);
      } catch {
        continue;
      }

      const result = await readPage(page as never, patterns);
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
