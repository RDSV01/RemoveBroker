/**
 * Classification des réponses des courtiers.
 *
 * Une demande d'effacement déclenche presque toujours une réponse. Huit
 * scénarios couvrent la quasi-totalité des cas, et chacun appelle une suite
 * différente. Sans cette étape, l'utilisateur devrait lire lui-même des
 * centaines d'emails: c'est précisément ce qu'on veut lui épargner.
 *
 * Méthode: on ne cherche pas des phrases toutes faites, on cherche des notions
 * et leurs combinaisons. « Your profile is gone from our site », « Your listing
 * has been taken down » et « Nous avons procédé à l'effacement » ne partagent
 * aucun mot mais portent les mêmes notions: un verbe d'effacement, un fait
 * accompli, un objet qui désigne les données de la personne. Le vocabulaire
 * vit dans lexicon.ts; ce fichier ne fait que peser les combinaisons.
 *
 * Règle de prudence: en cas de doute, on renvoie 'unknown' avec needsReview.
 * Marquer à tort une demande « terminée » ferait croire à une suppression qui
 * n'a pas eu lieu, ce qui est bien pire que de faire relire un message.
 */

import {
  ABOUT_YOU, ACK, ADDRESS_RETIRED, BOUNCE, CLICK_ACTION, CONFIRM_OBJECT, DATA_NOUN, DELETE_VERB,
  ID_DOC, INSTRUCTION, NEGATED_DELETE, NOT_BY_EMAIL, NOT_FOUND, NO_LONGER_PRESENT, OUT_OF_OFFICE,
  REQUEST_NAMING,
  PAST_DONE, PORTAL, PROVIDE_VERB, REFUSAL,
  PRISE_EN_CHARGE,
} from './lexicon.js';

export type ResponseType =
  | 'success'
  | 'confirmation_required'
  | 'form_required'
  | 'id_required'
  /** L'adresse écrite est morte et le courtier en indique une autre. */
  | 'address_changed'
  | 'rejected'
  | 'no_data'
  | 'pending'
  | 'bounced'
  | 'unknown';

export interface Classification {
  type: ResponseType;
  confidence: number;
  reason: string;
  confirmUrl?: string;
  formUrl?: string;
  /** Adresse de remplacement citée par le courtier, quand il en donne une. */
  altEmail?: string;
  urls: string[];
  needsReview: boolean;
}

/** Extrait toutes les URL du corps texte et des liens HTML. */
export function extractUrls(text: string, html?: string): { url: string; anchor: string }[] {
  const found: { url: string; anchor: string }[] = [];
  const seen = new Set<string>();

  const push = (url: string, anchor = '') => {
    const clean = url.replace(/[).,;'"\]]+$/, '').trim();
    if (!/^https?:\/\//i.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    found.push({ url: clean, anchor: anchor.replace(/\s+/g, ' ').trim().slice(0, 120) });
  };

  if (html) {
    const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html))) push(m[1], m[2].replace(/<[^>]+>/g, ' '));
  }
  const bareRe = /https?:\/\/[^\s<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = bareRe.exec(text))) push(m[0]);

  return found;
}

/**
 * Retire la citation de notre propre message.
 *
 * Un courtier répond en gardant l'historique: notre demande, qui parle
 * d'effacement, de données personnelles et d'article 17, se retrouve alors dans
 * le texte analysé. Sans ce nettoyage, chaque réponse contient les mots qui
 * prouvent une suppression, et tout serait classé « terminée ».
 */
/**
 * Empreintes de nos propres messages.
 *
 * Les marqueurs de citation classiques ne suffisent pas: un système de tickets
 * (Zendesk, Salesforce) recopie notre message sans « Le ... a écrit : », et il
 * arrive que la réponse de l'agent soit placée *entre* deux séparateurs. Couper
 * au premier séparateur perdrait la réponse; ne rien couper laisserait nos mots
 * « effacement », « données personnelles » nourrir le classement.
 *
 * On coupe donc à la première empreinte de notre propre gabarit: elles
 * n'apparaissent que dans le texte que nous avons écrit.
 */
const OWN_MESSAGE: RegExp[] = [
  /^\s*IDENTIFICATION\s*$/m,
  /^\s*(DEMANDE|REQUEST)\s*$/m,
  /R[ée]f[ée]rence de la demande\s*:/i,
  /Request r[ée]ference\s*:/i,
  /RB-[A-Z0-9]{6,16}/,
  /Madame,\s*Monsieur,/i,
  /To whom it may concern at/i,
  /Je vous [ée]cris pour exercer mon droit/i,
  /I am writing to exercise my right/i,
  /Je fais suite [àa] ma demande d.effacement/i,
  /I am following up on my data deletion request/i,
];

export function stripQuoted(text: string): string {
  const cut = [
    /^-{2,}\s*(message d'origine|original message|forwarded message)/im,
    /^_{5,}/m,
    /^\s*(le|on)\s.{0,80}\s(a\s+[ée]crit|wrote)\s*:/im,
    /^\s*(de|from)\s*:\s.{0,120}$/im,
    /^\s*envoy[ée]\s*:\s/im,
    ...OWN_MESSAGE,
  ]
    .map((re) => text.search(re))
    .filter((i) => i > 0);

  const end = cut.length ? Math.min(...cut) : text.length;
  return text
    .slice(0, end)
    // Lignes citées ligne à ligne, quel que soit le niveau d'imbrication.
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

/**
 * Deux notions se trouvent-elles assez près l'une de l'autre pour parler de la
 * même chose ?
 *
 * La cooccurrence sur un message entier ne prouve rien: « Nous avons ouvert un
 * billet [...] vous demandez la suppression de vos données » contient un verbe
 * d'effacement et un passé accompli à trente lignes d'écart, sans qu'aucune
 * suppression ait eu lieu. C'est ce qui a fait passer pour « supprimées » des
 * réponses qui ne l'annonçaient pas.
 */
export function near(text: string, a: RegExp, b: RegExp, span = 90): boolean {
  const positions = (re: RegExp): number[] => {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) && out.length < 40) {
      out.push(m.index);
      if (m.index === global.lastIndex) global.lastIndex++;
    }
    return out;
  };
  const left = positions(a);
  if (!left.length) return false;
  const right = positions(b);
  return right.some((j) => left.some((i) => Math.abs(i - j) <= span));
}

/**
 * Adresses citées dans le message, hors expéditeur technique.
 *
 * Volontairement sans arbitrage: quand un courtier renvoie vers trois adresses
 * selon le service concerné, choisir à sa place enverrait la demande au mauvais
 * endroit. On les remonte, l'utilisateur tranche en une seconde.
 */
export function citedAddresses(text: string, sender?: string): string[] {
  const senderAddress = (sender ?? '').toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    const email = m[0].toLowerCase().replace(/[.,;:)]+$/, '');
    if (seen.has(email) || email === senderAddress) continue;
    seen.add(email);
    if (/^(no-?reply|donotreply|nepasrepondre|postmaster|mailer-daemon|abuse)/i.test(email.split('@')[0])) continue;
    out.push(email);
    if (out.length >= 3) break;
  }
  return out;
}

const CONFIRM_URL_HINT = /(confirm|verif(y|ication)|validate|activate|optout|opt-out|removal|remove|erase|delete|unsubscribe|token|valider|confirmation)/i;
const CONFIRM_ANCHOR_HINT = /(confirm|verify|validate|complete|cliquez|valider|confirmer|activate)/i;
const NOISE_URL = /(privacy-?policy|terms|unsubscribe-?preferences|facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|apps?\.apple\.com|play\.google\.com)/i;
const FORM_URL_HINT = /(form|portal|request|privacy-?(request|center|centre)|dsar|optout|opt-out|removal|rights)/i;

/**
 * Une accumulation de points par type, avec la raison de chaque point.
 * Garder les raisons permet d'afficher à l'utilisateur pourquoi une demande a
 * changé d'état, et à un contributeur de comprendre un mauvais classement.
 */
class Tally {
  private readonly points = new Map<ResponseType, number>();
  private readonly reasons = new Map<ResponseType, string[]>();

  add(type: ResponseType, weight: number, reason: string): void {
    this.points.set(type, (this.points.get(type) ?? 0) + weight);
    if (weight > 0) {
      const list = this.reasons.get(type) ?? [];
      if (!list.includes(reason)) list.push(reason);
      this.reasons.set(type, list);
    }
  }

  score(type: ResponseType): number {
    return this.points.get(type) ?? 0;
  }

  why(type: ResponseType): string {
    return (this.reasons.get(type) ?? []).join(', ');
  }

  /** Types triés par score, l'ordre de la liste tranchant les égalités. */
  ranked(priority: ResponseType[]): { type: ResponseType; score: number }[] {
    return priority
      .map((type) => ({ type, score: this.score(type) }))
      .sort((a, b) => b.score - a.score || priority.indexOf(a.type) - priority.indexOf(b.type));
  }
}

/**
 * Ordre de priorité à score égal.
 *
 * Un message peut annoncer une suppression *et* demander une confirmation: ce
 * qui exige une action passe devant, sinon la demande resterait bloquée en
 * croyant être terminée.
 */
const PRIORITY: ResponseType[] = [
  'bounced', 'address_changed', 'confirmation_required', 'id_required', 'form_required',
  'rejected', 'no_data', 'success', 'pending',
];

/**
 * Mentions du sujet que nous n'écrivons jamais nous-mêmes.
 *
 * Le sujet d'une réponse est presque toujours le nôtre précédé de « Re: ». En
 * garder la totalité revenait à relire nos propres mots: « Absence jusqu'au 30
 * août Re: Demande d'effacement de données personnelles » apportait au
 * classement un verbe d'effacement et un nom de donnée, et un répondeur de
 * vacances a ainsi été compté comme une suppression confirmée, avec 0,99 de
 * confiance. Seul le marqueur lui-même est conservé.
 */
const SUBJECT_MARKER = /(undeliverable|delivery status notification|mail delivery (?:failed|subsystem)|returned mail|automatic reply|r[ée]ponse automatique|out of office|abwesenheit|urlaub|respuesta autom[áa]tica|vacaciones|absence|absent|cong[ée]s)/i;

export function classify(input: { subject: string; text: string; html?: string; from?: string }): Classification {
  const subject = input.subject ?? '';
  const body = stripQuoted(input.text ?? '');
  const subjectSignal = SUBJECT_MARKER.exec(subject)?.[0] ?? '';
  const haystack = `${subjectSignal}\n${body}`;
  const urls = extractUrls(body, input.html);
  const usefulUrls = urls.filter((u) => !NOISE_URL.test(u.url));
  const tally = new Tally();

  const has = (re: RegExp) => re.test(haystack);

  // --- rebond technique -----------------------------------------------------
  const fromBounce = /(mailer-daemon|postmaster)/i.test(input.from ?? '');
  if (has(BOUNCE)) tally.add('bounced', 6, 'notification de non-remise');
  if (fromBounce) tally.add('bounced', 4, 'expéditeur technique');

  // --- adresse morte, contact indiqué ailleurs ------------------------------
  // À traiter avant le reste: le message ne parle pas du tout de la demande,
  // il dit seulement où l'adresser. Sans cela il ressortait « indéterminé ».
  const addressRetired = has(ADDRESS_RETIRED);
  if (addressRetired) tally.add('address_changed', 6, 'adresse hors service, autre contact indiqué');

  // --- suppression effectuée ------------------------------------------------
  const deleteVerb = has(DELETE_VERB);
  const dataNoun = has(DATA_NOUN);
  const aboutYou = has(ABOUT_YOU);
  // Le verbe d'effacement décrit une marche à suivre, une question ou une
  // possibilité: rien n'a été fait.
  const instruction = has(INSTRUCTION);
  // Un acte accompli, et énoncé près du verbe: « nous avons ouvert un billet »
  // trente lignes avant « supprimer vos données » ne dit rien d'une suppression.
  const doneNearVerb = near(haystack, DELETE_VERB, PAST_DONE, 90);

  // « Your deletion request has been received »: le verbe d'effacement nomme
  // notre demande, il ne décrit pas un acte du courtier.
  const namesOurRequest = has(REQUEST_NAMING);
  const acknowledged = has(ACK);
  if (namesOurRequest && acknowledged) {
    tally.add('success', -5, '');
    tally.add('pending', 2, 'accusé portant sur la demande elle-même');
  }
  if (namesOurRequest && !doneNearVerb) tally.add('success', -3, '');

  if (doneNearVerb) tally.add('success', 4, 'effacement annoncé comme accompli');
  if (!instruction && near(haystack, DELETE_VERB, DATA_NOUN, 60)) tally.add('success', 2, 'effacement portant sur des données');
  if (!instruction && deleteVerb && aboutYou && !dataNoun) tally.add('success', 1, 'effacement vous concernant');
  // Une consigne annule la lecture « c'est fait »: « Pour supprimer vos données,
  // vous avez deux possibilités » décrit ce qu'il reste à faire.
  if (instruction && !doneNearVerb) tally.add('success', -4, '');
  if (has(NO_LONGER_PRESENT)) tally.add('success', 4, 'fiche disparue');
  // « ne seront pas supprimées » contient un verbe d'effacement mais dit
  // l'inverse: sans ce garde-fou, un refus passerait pour un succès.
  if (has(NEGATED_DELETE)) {
    tally.add('success', -6, '');
    tally.add('rejected', 3, 'effacement explicitement refusé');
  }

  // --- aucune donnée détenue ------------------------------------------------
  if (has(NOT_FOUND)) {
    tally.add('no_data', 4, 'aucun dossier trouvé');
    if (dataNoun || aboutYou) tally.add('no_data', 2, 'recherche à votre nom');
  }

  // --- confirmation à donner ------------------------------------------------
  const clickAction = has(CLICK_ACTION);
  const confirmObject = has(CONFIRM_OBJECT);
  const confirmCandidate = usefulUrls.find((u) => CONFIRM_URL_HINT.test(u.url) || CONFIRM_ANCHOR_HINT.test(u.anchor));

  if (clickAction && confirmObject) {
    // Une demande de confirmation sans lien n'a pas de sens: c'est le lien qui
    // fait la différence entre « cliquez ici » et « nous confirmons que ».
    //
    // Et pas n'importe quel lien: « Répondez à ce mail ou cliquez sur le lien
    // ci-dessous » suivi d'une URL de ticket est le pied de page de tous les
    // systèmes d'assistance. Compté comme une vraie confirmation, il masquait
    // la réponse elle-même: chez Fandom, « nous n'avons aucun compte à votre
    // nom » passait derrière le lien de suivi du ticket.
    tally.add('confirmation_required', confirmCandidate ? 5 : usefulUrls.length ? 3 : 2, 'geste de confirmation demandé');
  }
  if (confirmCandidate) tally.add('confirmation_required', 2, 'lien de confirmation reconnu');

  // Prise en charge annoncée sans geste attendu: la demande avance, elle
  // n'attend rien de l'utilisateur.
  if (has(PRISE_EN_CHARGE)) tally.add('pending', 4, 'demande prise en charge');
  if (clickAction && usefulUrls.length && !deleteVerb) tally.add('confirmation_required', 1, 'lien à suivre');

  // --- pièce d'identité réclamée --------------------------------------------
  if (has(ID_DOC)) {
    tally.add('id_required', 4, "document d'identité demandé");
    if (has(PROVIDE_VERB)) tally.add('id_required', 2, 'envoi du document demandé');
  }

  // --- formulaire obligatoire ------------------------------------------------
  const notByEmail = has(NOT_BY_EMAIL);
  const portal = has(PORTAL);
  if (notByEmail) tally.add('form_required', 3, "l'email n'est pas la voie acceptée");
  if (notByEmail && portal) tally.add('form_required', 3, 'renvoi vers un formulaire');
  // « portail » et « fourni » suffisaient à conclure « formulaire obligatoire »:
  // le mot « portal » figure dans l'en-tête de Choreograph et « provided » dans
  // « the information you have provided », si bien qu'une réponse « aucun
  // dossier vous concernant » était présentée comme un renvoi vers un
  // formulaire. Les deux notions doivent maintenant se répondre.
  if (portal && near(haystack, PORTAL, PROVIDE_VERB, 80)) tally.add('form_required', 2, 'formulaire à remplir');
  if (portal && usefulUrls.some((u) => FORM_URL_HINT.test(u.url))) tally.add('form_required', 2, 'lien vers le formulaire');

  // --- refus -----------------------------------------------------------------
  if (has(REFUSAL)) {
    tally.add('rejected', 3, 'refus ou exception invoquée');
    if (dataNoun) tally.add('rejected', 1, 'refus portant sur vos données');
  }

  // --- accusé de réception ---------------------------------------------------
  if (acknowledged) tally.add('pending', 3, 'accusé de réception');

  // --- arbitrage --------------------------------------------------------------
  const ranked = tally.ranked(PRIORITY);
  const best = ranked[0];
  const runnerUp = ranked[1];

  // Une absence prolongée n'est pas un traitement: on ne fait pas avancer la
  // demande sur la foi d'un répondeur automatique. Le renvoi vers une autre
  // adresse fait exception: il reste vrai, absence ou pas.
  if (has(OUT_OF_OFFICE) && best.score < 5 && !addressRetired) {
    return {
      type: 'pending',
      confidence: 0.5,
      reason: "réponse automatique d'absence",
      urls: urls.map((u) => u.url),
      needsReview: false,
    };
  }

  if (best.score <= 0) {
    return {
      type: 'unknown',
      confidence: 0,
      reason: 'aucun motif reconnu',
      urls: urls.map((u) => u.url),
      needsReview: true,
    };
  }

  /**
   * Confiance: part du motif dominant, tempérée par sa force absolue.
   *
   * L'ancienne formule ne regardait que la part relative: un unique motif à
   * 2 points, sans concurrent, donnait 0,99. « Pour supprimer vos données vous
   * avez deux possibilités » était ainsi annoncé « suppression confirmée » avec
   * la même assurance qu'un accusé de réception explicite. La force du motif
   * entre désormais dans le calcul: il faut au moins six points pour approcher
   * la certitude.
   */
  const total = ranked.reduce((sum, s) => sum + Math.max(0, s.score), 0) || 1;
  const share = best.score / total;
  const margin = (best.score - Math.max(0, runnerUp.score)) / 10;
  const strength = Math.min(1, best.score / 6);
  const confidence = Number(Math.min(0.99, (share + margin) * strength).toFixed(2));

  const formUrl = usefulUrls.find((u) => FORM_URL_HINT.test(u.url))?.url ?? usefulUrls[0]?.url;

  return {
    type: best.type,
    confidence,
    reason: tally.why(best.type) || 'motif générique',
    // Seul un lien reconnaissable comme lien de confirmation est proposé à
    // l'ouverture automatique. Se rabattre sur « la première URL du message »
    // faisait ouvrir des pages de profil publicitaire ou de ticket au nom d'une
    // confirmation qui n'en était pas une. Sans candidat, l'utilisateur décide.
    confirmUrl: best.type === 'confirmation_required' ? confirmCandidate?.url : undefined,
    formUrl: best.type === 'form_required' ? formUrl : undefined,
    altEmail: best.type === 'address_changed' ? citedAddresses(body, input.from)[0] : undefined,
    urls: urls.map((u) => u.url),
    // Un score faible ou une catégorie disputée méritent un œil humain.
    needsReview: best.score < 3 || confidence < 0.35,
  };
}

/**
 * Confiance minimale pour qu'un classement conclue tout seul.
 *
 * Le seuil ne couvre que les conclusions sur lesquelles l'utilisateur
 * s'appuie: suppression, absence de donnees, refus, echec. En dessous, la
 * reponse lui est presentee pour qu'il tranche, plutot que de lui annoncer
 * une suppression qui n'a peut-etre pas eu lieu.
 */
export const CONFIANCE_MINIMALE = 0.7;

/** Les classements dont une erreur induirait l'utilisateur en erreur. */
export const CONCLUSIONS = new Set<ResponseType>(['success', 'no_data', 'rejected', 'bounced']);

/** Libellés français des classements, partagés avec l'interface. */
export const CLASSIFICATION_LABELS: Record<ResponseType, string> = {
  success: 'Suppression confirmée',
  no_data: 'Aucune donnée détenue',
  rejected: 'Demande refusée',
  bounced: 'Adresse invalide',
  confirmation_required: 'Confirmation à donner',
  form_required: 'Formulaire obligatoire',
  id_required: "Pièce d'identité demandée",
  address_changed: 'Adresse hors service',
  pending: 'Accusé de réception',
  unknown: 'Sens indéterminé',
};

/** Statut de demande implique par une classification. */
export function statusForClassification(type: ResponseType): string | null {
  switch (type) {
    case 'success': return 'completed';
    case 'no_data': return 'no_data';
    case 'rejected': return 'rejected';
    case 'confirmation_required': return 'awaiting_reply';
    case 'form_required': return 'action_required';
    case 'id_required': return 'action_required';
    case 'address_changed': return 'action_required';
    case 'bounced': return 'failed';
    case 'pending': return 'awaiting_reply';
    default: return null;
  }
}
