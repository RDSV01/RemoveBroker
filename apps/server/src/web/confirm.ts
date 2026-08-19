import path from 'node:path';
import { paths } from '../config/paths.js';
import { createLogger } from '../util/logger.js';
import { launchContext, resolveBrowser } from './browser.js';
import type { Broker } from '../types.js';

const log = createLogger('confirm');

/**
 * Ouverture automatique des liens de confirmation.
 *
 * C'est l'étape qui évite à l'utilisateur d'ouvrir sa boîte mail. C'est aussi
 * la plus délicate: cliquer sur un lien reçu par email est exactement ce qu'on
 * apprend a ne pas faire. D'ou trois garde-fous stricts:
 *
 *   1. le lien doit être en HTTPS,
 *   2. son domaine doit appartenir au courtier concerné, ou à un prestataire
 *      de gestion des demandes reconnu,
 *   3. la réponse doit avoir été rattachée à une demande réellement envoyée.
 *
 * Un lien qui ne passe pas ces contrôles n'est jamais ouvert: la demande passe
 * en "action requise" et l'utilisateur décide.
 */

/** Prestataires utilisés par les courtiers pour héberger leurs formulaires de droits. */
const TRUSTED_PRIVACY_VENDORS = new Set([
  'onetrust.com', 'privacyportal.onetrust.com', 'trustarc.com', 'ketch.com',
  'securiti.ai', 'saymine.io', 'transcend.io', 'osano.com', 'didomi.io',
  'usercentrics.com', 'wirewheel.io', 'dataguard.de', 'ethyca.com',
  'privacyrequest.io', 'mydatarequest.com', 'datagrail.io', 'relyance.ai',
]);

const TWO_LEVEL = new Set(['co.uk', 'com.au', 'co.jp', 'co.nz', 'com.br', 'co.za', 'com.mx']);

function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export interface SafetyVerdict {
  safe: boolean;
  reason: string;
}

export function isLinkSafe(url: string, broker: Broker, senderAddress?: string): SafetyVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'lien illisible' };
  }
  if (parsed.protocol !== 'https:') return { safe: false, reason: 'lien non chiffre (http)' };

  const linkDomain = registrable(parsed.hostname);
  const brokerDomains = new Set<string>();
  if (broker.domain) brokerDomains.add(registrable(broker.domain));
  if (broker.website) {
    try { brokerDomains.add(registrable(new URL(broker.website).hostname)); } catch { /* site invalide */ }
  }
  if (broker.email) {
    const d = broker.email.split('@')[1];
    if (d) brokerDomains.add(registrable(d));
  }
  if (senderAddress) {
    const d = senderAddress.split('@')[1];
    if (d) brokerDomains.add(registrable(d));
  }

  if (brokerDomains.has(linkDomain)) return { safe: true, reason: `domaine du courtier (${linkDomain})` };
  if (TRUSTED_PRIVACY_VENDORS.has(linkDomain)) return { safe: true, reason: `prestataire de gestion des droits (${linkDomain})` };

  return { safe: false, reason: `domaine inattendu (${linkDomain})` };
}

export interface ConfirmResult {
  confirmed: boolean;
  message: string;
  screenshot?: string;
  finalUrl?: string;
}

/**
 * Ouvre le lien de confirmation. Utilise un navigateur quand il y en à un
 * (beaucoup de pages de confirmation ne valident qu'après exécution de leur
 * JavaScript), sinon se rabat sur une simple requête HTTP.
 */
export async function followConfirmationLink(options: { url: string; broker: Broker; requestId: string; senderAddress?: string }): Promise<ConfirmResult> {
  const verdict = isLinkSafe(options.url, options.broker, options.senderAddress);
  if (!verdict.safe) {
    return { confirmed: false, message: `Lien non ouvert automatiquement: ${verdict.reason}.` };
  }

  if (!resolveBrowser()) {
    // Repli sans navigateur: suffisant pour les liens de confirmation
    // classiques qui valident côté serveur des l'appel HTTP.
    try {
      const res = await fetch(options.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 RemoveBroker' } });
      const ok = res.status < 400;
      log.info('lien de confirmation ouvert sans navigateur', { broker: options.broker.id, statut: res.status });
      return { confirmed: ok, message: ok ? `Lien de confirmation ouvert (HTTP ${res.status}).` : `Le site a répondu HTTP ${res.status}.`, finalUrl: res.url };
    } catch (err) {
      return { confirmed: false, message: `Ouverture impossible: ${(err as Error).message}` };
    }
  }

  let browser;
  let context;
  try {
    ({ browser, context } = await launchContext({}));
    const page = await context.newPage();
    const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);

    // Certaines pages exigent un dernier clic explicite.
    for (const label of ['Confirm', 'Confirmer', 'Verify', 'Yes', 'Oui', 'Continue', 'Submit', 'Valider']) {
      const button = page.getByRole('button', { name: new RegExp(`^\\s*${label}`, 'i') }).first();
      if (await button.count().catch(() => 0)) {
        await button.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        break;
      }
    }

    const file = path.join(paths.evidenceDir, `${options.requestId}-confirmation-${Date.now()}.png`);
    await page.screenshot({ path: file }).catch(() => undefined);

    const status = response?.status() ?? 0;
    const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    const failed = /(expired|invalid|no longer valid|lien expire|deja utilise|already been used)/i.test(text);

    log.info('lien de confirmation ouvert', { broker: options.broker.id, statut: status });
    return {
      confirmed: status < 400 && !failed,
      message: failed ? 'Le lien de confirmation a expiré ou a déjà été utilise.' : `Confirmation ouverte (HTTP ${status}).`,
      screenshot: file,
      finalUrl: page.url(),
    };
  } catch (err) {
    return { confirmed: false, message: `Ouverture impossible: ${(err as Error).message}` };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
