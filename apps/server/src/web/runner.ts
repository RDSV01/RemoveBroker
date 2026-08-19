import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { paths } from '../config/paths.js';
import { createLogger } from '../util/logger.js';
import { launchContext } from './browser.js';
import type { Broker, Profile, Recipe } from '../types.js';
import { templateVariables } from '../core/profile.js';

const log = createLogger('runner');

/**
 * Exécution d'une recette de formulaire.
 *
 * Le principe: aucune ligne de code par courtier. Une recette décrit ou aller,
 * quoi remplir et comment reconnaître le succès; le moteur fait le reste et
 * conserve une capture d'écran comme preuve.
 *
 * Ce que le moteur refuse de faire: deviner. Si un champ obligatoire est
 * introuvable ou si un captcha bloque, la demande passe en "action requise"
 * avec la raison exacte, plutôt que de prétendre avoir réussi.
 */

export type RunOutcome = 'submitted' | 'captcha' | 'not_found' | 'selector_missing' | 'error';

export interface RunResult {
  outcome: RunOutcome;
  message: string;
  screenshot?: string;
  finalUrl?: string;
  listingUrl?: string;
  /** Page a ouvrir si l'utilisateur doit terminer lui-même. */
  manualUrl?: string;
}

const CAPTCHA_MARKERS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  '.g-recaptcha',
  '#h-captcha',
  '[data-sitekey]',
];

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

/** Encodage pour les gabarits d'URL uniquement. */
function interpolateUrl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? ''));
}

async function hasCaptcha(page: Page): Promise<boolean> {
  for (const marker of CAPTCHA_MARKERS) {
    if (await page.locator(marker).first().count().catch(() => 0)) return true;
  }
  return false;
}

async function screenshot(page: Page, requestId: string, label: string): Promise<string> {
  const file = path.join(paths.evidenceDir, `${requestId}-${label}-${Date.now()}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return '';
  }
}

/**
 * Renseigne un champ en tolérant les variantes de sélecteurs. Une recette liste
 * plusieurs sélecteurs séparés par des virgules parce que les courtiers
 * renomment leurs champs sans prévenir.
 */
async function fillField(page: Page, selector: string, value: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (!count) return false;

  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  try {
    if (tag === 'select') {
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption(value);
      });
    } else {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await locator.fill(value, { timeout: 8000 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function runRecipe(options: {
  recipe: Recipe;
  broker: Broker;
  profile: Profile;
  requestId: string;
  headed?: boolean;
}): Promise<RunResult> {
  const { recipe, broker, profile, requestId, headed = false } = options;
  const vars = templateVariables(profile);

  let browser;
  let context;
  try {
    ({ browser, context } = await launchContext({ headed, locale: profile.language === 'fr' ? 'fr-FR' : 'en-US' }));
  } catch (err) {
    return { outcome: 'error', message: String((err as Error).message) };
  }

  const page = await context.newPage();
  if (recipe.timeoutMs) page.setDefaultTimeout(recipe.timeoutMs);

  try {
    // --- phase 1: retrouver la fiche publique ------------------------------
    let listingUrl: string | undefined;
    if (recipe.kind === 'search-form' && recipe.search) {
      const searchUrl = interpolateUrl(recipe.search.url, vars);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      if (await hasCaptcha(page)) {
        const shot = await screenshot(page, requestId, 'captcha-recherche');
        return { outcome: 'captcha', message: 'Un captcha protégé la page de recherche.', screenshot: shot, manualUrl: searchUrl };
      }

      if (recipe.search.listingPattern) {
        const pattern = new RegExp(recipe.search.listingPattern, 'i');
        const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => (e as unknown as { href: string }).href));
        listingUrl = hrefs.find((h) => pattern.test(h));
        if (!listingUrl) {
          const shot = await screenshot(page, requestId, 'aucune-fiche');
          return {
            outcome: 'not_found',
            message: "Aucune fiche publique trouvée à votre nom sur ce site.",
            screenshot: shot,
            finalUrl: page.url(),
          };
        }
      }
    }

    // --- phase 2: remplir et soumettre le formulaire -----------------------
    const formUrl = interpolate(recipe.form.url, { ...vars, listingUrl: listingUrl ?? '' });
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await dismissCookieBanner(page);

    if (await hasCaptcha(page)) {
      const shot = await screenshot(page, requestId, 'captcha');
      return {
        outcome: 'captcha',
        message: "Ce formulaire est protégé par un captcha: une validation humaine est nécessaire.",
        screenshot: shot,
        manualUrl: formUrl,
        listingUrl,
      };
    }

    const missing: string[] = [];
    for (const field of recipe.form.fields) {
      const value = interpolate(field.value, { ...vars, listingUrl: listingUrl ?? '' });
      if (!value && field.optional) continue;
      const ok = await fillField(page, field.selector, value);
      if (!ok && !field.optional) missing.push(field.selector);
    }

    if (missing.length) {
      const shot = await screenshot(page, requestId, 'champ-manquant');
      return {
        outcome: 'selector_missing',
        message: `Le formulaire a change: ${missing.length} champ(s) introuvable(s).`,
        screenshot: shot,
        manualUrl: formUrl,
        finalUrl: page.url(),
      };
    }

    // Cases a cocher de consentement, présentes sur la moitié des formulaires.
    for (const box of await page.locator('input[type="checkbox"]:not([disabled])').all()) {
      const checked = await box.isChecked().catch(() => true);
      if (!checked) await box.check({ timeout: 3000 }).catch(() => undefined);
    }

    const urlBefore = page.url();
    const submit = page.locator(recipe.form.submit).first();
    if (!(await submit.count().catch(() => 0))) {
      const shot = await screenshot(page, requestId, 'bouton-manquant');
      return { outcome: 'selector_missing', message: 'Bouton de validation introuvable.', screenshot: shot, manualUrl: formUrl };
    }

    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 15_000 }),
      submit.click({ timeout: 10_000 }),
    ]);
    await page.waitForTimeout(2500);

    // --- phase 3: vérifier le résultat -------------------------------------
    const finalUrl = page.url();
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    const shot = await screenshot(page, requestId, 'resultat');

    const expectedUrl = recipe.form.success?.urlContains ?? [];
    const expectedText = recipe.form.success?.text ?? [];
    const urlMatch = expectedUrl.some((frag) => finalUrl.toLowerCase().includes(frag.toLowerCase()));
    const textMatch = expectedText.some((frag) => bodyText.includes(frag.toLowerCase()));
    const navigated = finalUrl !== urlBefore;

    if (urlMatch || textMatch || navigated) {
      log.info('formulaire soumis', { broker: broker.id, verifie: urlMatch || textMatch });
      return {
        outcome: 'submitted',
        message: urlMatch || textMatch
          ? 'Formulaire soumis, confirmation affichée par le site.'
          : 'Formulaire soumis. Le site a change de page sans message explicite.',
        screenshot: shot,
        finalUrl,
        listingUrl,
      };
    }

    if (await hasCaptcha(page)) {
      return { outcome: 'captcha', message: 'Un captcha est apparu après validation.', screenshot: shot, manualUrl: formUrl, listingUrl };
    }

    return {
      outcome: 'error',
      message: "Le site n'a affiche aucune confirmation après validation.",
      screenshot: shot,
      finalUrl,
      manualUrl: formUrl,
      listingUrl,
    };
  } catch (err) {
    const shot = await screenshot(page, requestId, 'erreur').catch(() => '');
    return { outcome: 'error', message: String((err as Error).message).slice(0, 300), screenshot: shot, manualUrl: recipe.form.url };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

/** Les bandeaux de consentement recouvrent les boutons et font échouer le clic. */
async function dismissCookieBanner(page: Page): Promise<void> {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button#didomi-notice-agree-button',
    'button[aria-label*="accept" i]',
    'button:has-text("Accept all")',
    'button:has-text("Tout accepter")',
    'button:has-text("I agree")',
    '.cc-allow',
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(400);
      return;
    }
  }
}

export function evidencePathToId(file: string): string {
  return path.basename(file);
}

export function readEvidence(fileName: string): Buffer | null {
  const safe = path.basename(fileName);
  const full = path.join(paths.evidenceDir, safe);
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}
