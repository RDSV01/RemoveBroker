/// <reference lib="dom" />
// Le corps de page.evaluate s'exécute dans le navigateur, pas dans Node: sans
// cette référence, `document` et les types de champs de formulaire n'existent
// pas à la compilation. Elle ne change rien à l'exécution côté serveur.

import type { Page } from 'playwright-core';
import { launchContext } from './browser.js';
import { templateVariables } from '../core/profile.js';
import { createLogger } from '../util/logger.js';
import type { Broker, Profile } from '../types.js';

const log = createLogger('assist');

/**
 * Remplissage assisté d'un formulaire d'opt-out.
 *
 * Vingt courtiers ont une recette écrite à la main; les autres, non, et écrire
 * mille recettes est hors de portée. Mais ces formulaires demandent tous les
 * mêmes cinq informations. Un appariement générique entre les champs de la page
 * et les champs du profil couvre donc la majorité des sites sans qu'aucune
 * recette n'existe.
 *
 * L'envoi reste manuel, volontairement. C'est ce qui permet à l'utilisateur de
 * relire avant de s'engager, de résoudre un captcha, et de ne jamais soumettre
 * une donnée fausse en son nom sans l'avoir vue.
 */

export interface AssistReport {
  url: string;
  filled: { champ: string; valeur: string }[];
  ignored: number;
  captcha: boolean;
  /** Faux quand la page ne contient aucun formulaire d exercice de droits. */
  formDetected: boolean;
}

/** Fenêtres ouvertes, gardées en vie tant que l'utilisateur ne les ferme pas. */
const openSessions = new Set<{ close: () => Promise<void> }>();

export function assistedSessions(): number {
  return openSessions.size;
}

/**
 * Correspondance entre un champ de formulaire et une donnée du profil.
 *
 * L'ordre compte: « prénom » contient « nom », donc les motifs les plus
 * spécifiques doivent être testés en premier.
 */
const FIELD_RULES: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'emailConfirm', label: 'Confirmation email', patterns: /(confirm|verif|repeat|retype).{0,12}(e-?mail|courriel)|(e-?mail|courriel).{0,12}(confirm|again)/i },
  { key: 'email', label: 'Email', patterns: /e-?mail|courriel|adresse[\s_-]?electronique/i },
  { key: 'firstName', label: 'Prénom', patterns: /(pr[ée]nom|first[\s_-]?name|given[\s_-]?name|\bfname\b|\bforename\b)/i },
  { key: 'lastName', label: 'Nom', patterns: /(nom[\s_-]?de[\s_-]?famille|last[\s_-]?name|sur[\s_-]?name|family[\s_-]?name|\blname\b)/i },
  { key: 'fullName', label: 'Nom complet', patterns: /(nom[\s_-]?complet|full[\s_-]?name|your[\s_-]?name|votre[\s_-]?nom|^name$|\bnom\b)/i },
  { key: 'phone', label: 'Téléphone', patterns: /(t[ée]l[ée]phone|\btel\b|phone|mobile|portable|\bcell\b)/i },
  { key: 'zip', label: 'Code postal', patterns: /(code[\s_-]?postal|postal[\s_-]?code|zip|\bcp\b|postcode)/i },
  { key: 'city', label: 'Ville', patterns: /(ville|city|town|locality|commune)/i },
  { key: 'state', label: 'Région', patterns: /(r[ée]gion|state|province|d[ée]partement|county)/i },
  { key: 'country', label: 'Pays', patterns: /(pays|country|nation)/i },
  { key: 'address', label: 'Adresse', patterns: /(adresse|address|street|\brue\b|address[\s_-]?line)/i },
  { key: 'dob', label: 'Date de naissance', patterns: /(naissance|birth|\bdob\b|birthday)/i },
  { key: 'listingUrl', label: 'Lien de la fiche', patterns: /(url|lien|link|profile[\s_-]?(page|link)|listing)/i },
  { key: 'reason', label: 'Motif', patterns: /(message|comment|motif|raison|reason|details|description|request|demande)/i },
];

/** Valeurs proposées pour chaque clé, à partir du profil. */
function valuesFor(profile: Profile, listingUrl?: string): Record<string, string> {
  const v = templateVariables(profile);
  return {
    email: v.email,
    emailConfirm: v.email,
    firstName: v.firstName,
    lastName: v.lastName,
    fullName: v.fullName,
    phone: v.phone,
    address: v.address,
    city: v.city,
    state: v.state,
    zip: v.zip,
    country: v.country,
    dob: v.dob,
    listingUrl: listingUrl ?? '',
    reason: profile.language === 'fr'
      ? "Demande d'effacement de mes données personnelles au titre de l'article 17 du RGPD."
      : 'Request for erasure of my personal data under Article 17 GDPR.',
  };
}

/**
 * Remplit la page.
 *
 * Tout se passe dans le navigateur en une seule évaluation: c'est le seul
 * moyen de lire les étiquettes associées, et de déclencher les événements
 * `input` et `change` sans lesquels les formulaires React ignorent une valeur
 * écrite par script.
 */
async function fillPage(page: Page, rules: { key: string; label: string; source: string }[], values: Record<string, string>) {
  return page.evaluate(
    ({ rules, values }) => {
      const filled: { champ: string; valeur: string }[] = [];
      let ignored = 0;

      /** Texte décrivant un champ: attributs, étiquette liée, texte voisin. */
      const describe = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
        const parts = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'),
          el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.getAttribute('title')];
        if (el.id) {
          const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (label) parts.push(label.textContent);
        }
        const wrapping = el.closest('label');
        if (wrapping) parts.push(wrapping.textContent);
        return parts.filter(Boolean).join(' ').slice(0, 300);
      };

      const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        // Passer par le setter natif: React remplace la propriété `value` et
        // ignore une écriture directe.
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.style.outline = '2px solid #0e7c86';
        el.style.outlineOffset = '1px';
      };

      /**
       * Le conteneur du champ ressemble-t-il à un formulaire d'opt-out ?
       *
       * Une politique de confidentialité contient souvent une barre de
       * recherche, une inscription à la lettre d'information et un formulaire
       * de contact. Sans ce tri, l'assistant remplissait ces champs-là et
       * annonçait fièrement neuf champs remplis sur une page qui n'offre aucun
       * moyen de demander une suppression.
       */
      const containerOf = (el: Element): Element => el.closest('form') ?? el.parentElement?.parentElement ?? el;

      const contextScore = (el: Element): number => {
        const box = containerOf(el);
        const text = (box.textContent ?? '').slice(0, 1500).toLowerCase();
        const inputs = Array.from(box.querySelectorAll('input, textarea, select'));

        let score = 0;
        // Intention explicite d'exercer un droit.
        if (/(opt[\s-]?out|do not sell|deletion|delete my|removal|erase|supprim|effac|droits|rights request|dsar|privacy request)/.test(text)) score += 4;
        // Un vrai formulaire d'exercice de droits demande plusieurs éléments.
        if (inputs.length >= 3) score += 2;
        if (box.querySelector('textarea')) score += 1;
        if (box.querySelector('button, input[type="submit"]')) score += 1;

        // Contextes qui ne sont jamais un formulaire d'opt-out.
        if (box.querySelector('input[type="password"]')) score -= 8;
        if (/(newsletter|s.abonner|subscribe|sign up for|stay informed|book a demo|demander une d[ée]mo|request a demo|contact sales)/.test(text)) score -= 6;
        if (el instanceof HTMLInputElement && el.type === 'search') score -= 6;
        if (/(recherche|search|query)/.test((el.getAttribute('name') ?? '') + (el.getAttribute('placeholder') ?? ''))) score -= 6;

        return score;
      };

      const fields = Array.from(document.querySelectorAll('input, textarea, select')) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];

      // On ne remplit rien tant qu'aucun conteneur ne ressemble à un formulaire
      // d'exercice de droits: mieux vaut dire « rien trouvé » que remplir la
      // barre de recherche d'une page de politique de confidentialité.
      const bestContext = fields.reduce((best, el) => Math.max(best, contextScore(el)), 0);
      if (bestContext < 4) {
        const captchaOnly = Boolean(
          document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha'),
        );
        return { filled: [], ignored: fields.length, captcha: captchaOnly, formDetected: false };
      }

      for (const el of fields) {
        // Un champ isolé dans un contexte non pertinent est laissé tranquille,
        // même si son nom correspond à une donnée du profil.
        if (contextScore(el) < 4) { ignored++; continue; }
        if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'image', 'file', 'checkbox', 'radio'].includes(el.type)) continue;
        if (el.disabled || (el as HTMLInputElement).readOnly) continue;
        // Un champ déjà rempli par le site ne doit pas être écrasé.
        if ('value' in el && el.value && el.value.trim().length > 0) continue;

        const haystack = describe(el);
        const match = rules.find((r) => new RegExp(r.source, 'i').test(haystack));
        if (!match) { ignored++; continue; }

        const value = values[match.key];
        if (!value) { ignored++; continue; }

        if (el instanceof HTMLSelectElement) {
          const option = Array.from(el.options).find((o) => o.text.toLowerCase().includes(value.toLowerCase())
            || o.value.toLowerCase() === value.toLowerCase());
          if (!option) { ignored++; continue; }
          el.value = option.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.style.outline = '2px solid #0e7c86';
        } else {
          setValue(el, value);
        }
        filled.push({ champ: match.label, valeur: value });
      }

      const captcha = Boolean(
        document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, iframe[src*="turnstile"]'),
      );

      return { filled, ignored, captcha, formDetected: true };
    },
    { rules, values },
  );
}

/**
 * Ouvre le formulaire du courtier dans une fenêtre visible, pré-remplie.
 * La fenêtre reste ouverte: c'est l'utilisateur qui relit puis soumet.
 */
export async function openAssisted(options: {
  broker: Broker;
  profile: Profile;
  url: string;
  listingUrl?: string;
}): Promise<AssistReport> {
  const { broker, profile, url, listingUrl } = options;

  const { browser, context } = await launchContext({
    headed: true,
    locale: profile.language === 'fr' ? 'fr-FR' : 'en-US',
  });

  const session = { close: async () => { await context.close().catch(() => {}); await browser.close().catch(() => {}); } };
  openSessions.add(session);

  const page = await context.newPage();
  // La fenêtre appartient à l'utilisateur: quand il la ferme, on libère tout.
  page.on('close', () => {
    openSessions.delete(session);
    void session.close();
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Laisser le temps aux formulaires chargés en JavaScript d'apparaître.
    await page.waitForTimeout(2500);

    const rules = FIELD_RULES.map((r) => ({ key: r.key, label: r.label, source: r.patterns.source }));
    const report = await fillPage(page, rules, valuesFor(profile, listingUrl));

    log.info('formulaire pré-rempli', { broker: broker.id, champs: report.filled.length, captcha: report.captcha });
    return { url, ...report };
  } catch (err) {
    openSessions.delete(session);
    await session.close();
    throw new Error(`Impossible d'ouvrir le formulaire: ${(err as Error).message}`);
  }
}

/**
 * Remplit puis soumet le formulaire sans fenêtre visible.
 *
 * Réservé aux personnes qui activent l'option: la demande part alors sans
 * aucun geste, comme un email. Trois garde-fous, parce qu'une soumission
 * automatique engage l'utilisateur:
 *   - un vrai formulaire d'exercice de droits doit avoir été reconnu,
 *   - au moins deux champs d'identité doivent avoir été remplis, sinon la
 *     demande partirait incomplète et serait rejetée,
 *   - aucun captcha ne doit protéger la page, sinon la soumission échouerait
 *     silencieusement et l'utilisateur croirait sa demande partie.
 * Dans tous les autres cas, la main revient à l'utilisateur.
 */
export async function submitAutomatically(options: {
  broker: Broker;
  profile: Profile;
  url: string;
  requestId: string;
}): Promise<AssistReport & { submitted: boolean; reason?: string; finalUrl?: string }> {
  const { broker, profile, url } = options;

  const { browser, context } = await launchContext({
    headed: false,
    locale: profile.language === 'fr' ? 'fr-FR' : 'en-US',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);

    const rules = FIELD_RULES.map((r) => ({ key: r.key, label: r.label, source: r.patterns.source }));
    const report = await fillPage(page, rules, valuesFor(profile));

    if (!report.formDetected) {
      return { url, ...report, submitted: false, reason: "aucun formulaire d'exercice de droits sur cette page" };
    }
    if (report.captcha) {
      return { url, ...report, submitted: false, reason: 'un captcha protège ce formulaire' };
    }
    if (report.filled.length < 2) {
      return { url, ...report, submitted: false, reason: 'trop peu de champs reconnus pour une demande complète' };
    }

    // Le bouton d'envoi: on préfère celui dont le libellé parle d'une demande,
    // pour ne pas déclencher une inscription à la lettre d'information voisine.
    const submitted = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const scored = forms
        .map((form) => {
          const text = (form.textContent ?? '').toLowerCase();
          const filledFields = Array.from(form.querySelectorAll('input, textarea, select'))
            .filter((el) => (el as HTMLInputElement).style.outline.includes('2px'));
          return { form, filledFields: filledFields.length, wanted: /(opt|delete|remov|erase|supprim|effac|request|demande)/.test(text) };
        })
        .filter((f) => f.filledFields >= 2)
        .sort((a, b) => Number(b.wanted) - Number(a.wanted) || b.filledFields - a.filledFields);

      const target = scored[0]?.form;
      if (!target) return false;

      const button = target.querySelector('button[type="submit"], input[type="submit"], button:not([type])') as HTMLElement | null;
      if (button) { button.click(); return true; }
      // Certains formulaires n'ont pas de bouton typé: on soumet le formulaire.
      target.requestSubmit?.();
      return true;
    });

    if (!submitted) {
      return { url, ...report, submitted: false, reason: "aucun bouton d'envoi identifié" };
    }

    await page.waitForTimeout(4000);
    const finalUrl = page.url();
    const confirmed = await page.evaluate(() => {
      const text = (document.body?.innerText ?? '').toLowerCase();
      return /(thank you|received|submitted|success|confirm|merci|re[çc]ue|enregistr[ée]e?|envoy[ée]e?)/.test(text);
    });

    log.info('formulaire soumis automatiquement', { broker: broker.id, confirme: confirmed });
    return {
      url,
      ...report,
      submitted: true,
      finalUrl,
      reason: confirmed ? undefined : 'soumis, sans message de confirmation reconnu',
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
