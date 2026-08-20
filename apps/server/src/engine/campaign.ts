import { addDays, getDb, nowIso } from '../db/index.js';
import { allBrokers, getBroker, getRecipe } from '../core/catalog.js';
import { getProfile, legalBasisFor, requireProfile } from '../core/profile.js';
import { getSetting } from '../core/settings.js';
import { createLogger } from '../util/logger.js';
import { renderMail } from '../mail/templates.js';
import { sendMail } from '../mail/smtp.js';
import { runRecipe } from '../web/runner.js';
import { followConfirmationLink } from '../web/confirm.js';
import { bus, notify } from './bus.js';
import { enqueue, registerHandler, requestIdsWithPendingJob, type Job } from './queue.js';
import { browserStatus } from '../web/browser.js';
import { discoverContact, isContactDead } from '../web/discover.js';
import { submitAutomatically } from '../web/assist.js';
import {
  addArtifact, addEvent, addMessage, createRequest, emailsSentToday, getRequest,
  hasOpenRequest, newId, setStatus, updateRequest,
} from './store.js';
import type { Broker, RequestMethod, RequestRow, ScheduleSettings } from '../types.js';

const log = createLogger('campaign');

/**
 * Orchestration des campagnes.
 *
 * Une campagne sélectionné des courtiers, créé une demande par courtier et
 * empile un travail par demande. Le rythme est volontairement lent: envoyer
 * mille emails en une heure depuis une boîte personnelle la fait suspendre.
 */

export type CampaignScope = 'all' | 'recommended' | 'selection';

export interface CampaignOptions {
  scope: CampaignScope;
  brokerIds?: string[];
  /** Filtres appliqués quand scope vaut 'all' ou 'recommended'. */
  categories?: string[];
  regions?: string[];
  useEmail?: boolean;
  useWeb?: boolean;
  /** Renvoyer même si une demande est déjà ouverte chez ce courtier. */
  force?: boolean;
  /** Par défaut, celle du profil. Sert à prévisualiser avant enregistrement. */
  jurisdiction?: string;
}

/** Méthode retenue pour un courtier donne, selon ce qui est active. */
function chooseMethod(broker: Broker, useEmail: boolean, useWeb: boolean): RequestMethod | null {
  // Sans navigateur, une recette echouerait a coup sur: mieux vaut retomber sur
  // l email, qui aboutit chez la plupart des courtiers.
  if (useWeb && browserStatus().available && broker.recipe && getRecipe(broker.recipe)) return 'recipe';
  if (useEmail && broker.email) return 'email';
  // Ni recette ni email: le courtier n'expose qu'un formulaire manuel. On créé
  // quand même la demande pour qu'elle apparaisse dans la liste des actions.
  if (broker.optOutUrl) return 'form';
  return null;
}

/**
 * Pertinence d'un courtier pour la personne concernée.
 *
 * Le catalogue est mondial, mais l'ordre des demandes ne doit pas l'être. Pour
 * un résident français, écrire d'abord aux régies publicitaires et aux bases
 * B2B européennes donne des suppressions réelles; écrire aux annuaires de
 * dossiers judiciaires du Texas ne donne que des "aucune donnée vous
 * concernant". L'inverse vaut pour un résident américain.
 */
export function relevanceScore(broker: Broker, jurisdiction: string): number {
  let score = broker.score;

  // La France d'abord: une société française répond en français, connaît la
  // CNIL, et sa fiche vous concerne à coup sûr. Vient ensuite le reste de
  // l'Europe, puis les grands acteurs mondiaux qui détiennent des données
  // européennes sans être établis ici.
  if (broker.france) score += 45;
  if (broker.regions.includes('fr')) score += 20;
  if (broker.regions.includes('eu')) score += 15;
  if (jurisdiction === 'uk' && broker.regions.includes('uk')) score += 25;

  return score;
}

export function selectBrokers(options: CampaignOptions): Broker[] {
  const all = allBrokers();
  const jurisdiction = options.jurisdiction ?? getProfile()?.jurisdiction ?? 'eu';
  let list: Broker[];

  if (options.scope === 'selection') {
    const wanted = new Set(options.brokerIds ?? []);
    list = all.filter((b) => wanted.has(b.id));
  } else if (options.scope === 'recommended') {
    // Sélection resserrée: les sociétés françaises, puis celles qui exposent le
    // plus de données. Le catalogue étant déjà limité à l'Europe, il ne s'agit
    // plus d'écarter une zone mais de commencer par ce qui aboutit le mieux.
    //
    // Les entrées sans contact connu sont écartées ici: chacune déclencherait
    // une exploration du site depuis le poste de l'utilisateur, longue et le
    // plus souvent vaine puisque l'enrichissement hebdomadaire a déjà échoué.
    // Le mode complet les garde, pour qui veut tenter malgré tout.
    list = all.filter((b) => (b.email || b.optOutUrl) && (b.france || b.score >= 60));
  } else {
    list = all;
  }

  if (options.categories?.length) list = list.filter((b) => options.categories!.includes(b.category));
  if (options.regions?.length) list = list.filter((b) => b.regions.some((r) => options.regions!.includes(r)));

  const hidden = new Set(
    (getDb().prepare('SELECT broker_id FROM broker_state WHERE hidden = 1').all() as { broker_id: string }[]).map((r) => r.broker_id),
  );
  list = list.filter((b) => !hidden.has(b.id));

  return list.sort((a, b) => relevanceScore(b, jurisdiction) - relevanceScore(a, jurisdiction));
}

export function createCampaign(options: CampaignOptions): {
  id: string;
  total: number;
  skipped: number;
  skippedReasons: { alreadyOpen: number; noContact: number };
  /** Repartition par methode: l utilisateur doit savoir ce qui part tout seul
   *  et ce qui l attend. Un formulaire sans recette ne s envoie pas. */
  byMethod: { email: number; recipe: number; form: number };
} {
  const profile = requireProfile();
  const automation = getSetting('automation');
  const useEmail = options.useEmail ?? automation.emailEnabled;
  const useWeb = options.useWeb ?? automation.webEnabled;

  const brokers = selectBrokers(options);
  const id = newId();
  const label = options.scope === 'all'
    ? 'Protection complète'
    : options.scope === 'recommended'
      ? 'Courtiers prioritaires'
      : `Sélection de ${brokers.length} courtiers`;

  getDb().prepare('INSERT INTO campaign (id, label, status, options, total, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, label, 'running', JSON.stringify(options), 0, nowIso());

  const basis = legalBasisFor(profile);
  // Un mois partout en Europe, article 12.3 du RGPD.
  const deadlineDays = 30;
  let created = 0;
  let skipped = 0;
  // Deux causes d ecart tres differentes: l une est definitive, l autre veut
  // simplement dire que la demande est deja partie. Les confondre laisse
  // l utilisateur sans savoir quoi faire.
  const skippedReasons = { alreadyOpen: 0, noContact: 0 };
  const byMethod = { email: 0, recipe: 0, form: 0 };

  const insert = getDb().transaction((items: Broker[]) => {
    for (const broker of items) {
      const method = chooseMethod(broker, useEmail, useWeb);
      if (!options.force && hasOpenRequest(broker.id)) { skipped++; skippedReasons.alreadyOpen++; continue; }

      // Aucun contact connu, mais le courtier a un site et un navigateur est
      // disponible: l'application ira lire sa politique de confidentialité
      // elle-même. Beaucoup de sites refusent le robot du catalogue tout en
      // répondant normalement à un navigateur, et l'adresse qu'ils publient
      // s'y trouve. Rien de tout cela ne concerne l'utilisateur.
      if (!method && broker.website && browserStatus().available) {
        const request = createRequest({
          campaignId: id,
          brokerId: broker.id,
          brokerName: broker.name,
          method: 'form',
          legalBasis: basis,
          deadlineDays,
        });
        // « En cours » serait faux: la recherche est programmée, pas commencée.
        // Deux travaux tournent à la fois, et une campagne complète en met des
        // centaines en attente. Le tableau de bord annonçait 341 recherches
        // simultanées quand il s'en faisait deux.
        setStatus(request.id, 'queued', 'Recherche du contact programmée sur le site du courtier.');
        enqueue('discover_contact', { requestId: request.id }, { priority: 120 });
        byMethod.form++;
        created++;
        continue;
      }

      if (!method) { skipped++; skippedReasons.noContact++; continue; }

      const request = createRequest({
        campaignId: id,
        brokerId: broker.id,
        brokerName: broker.name,
        method,
        legalBasis: basis,
        deadlineDays,
      });

      if (method === 'email') {
        enqueue('send_email', { requestId: request.id }, { priority: 100 - Math.min(99, broker.score) });
      } else if (method === 'recipe') {
        enqueue('run_recipe', { requestId: request.id }, { priority: 100 - Math.min(99, broker.score) });
      } else if (automation.autoSubmitForms && browserStatus().available) {
        // L'utilisateur a choisi le zero-geste: le formulaire est traité comme
        // un envoi, et ne lui revient que si un captcha ou une page inattendue
        // empêche la soumission.
        enqueue('submit_form', { requestId: request.id }, { priority: 110 });
      } else {
        // Formulaire sans recette: rien a automatiser, l'utilisateur décide.
        setStatus(request.id, 'action_required', "Formulaire à remplir sur le site du courtier.", { url: broker.optOutUrl });
      }
      byMethod[method === 'recipe' ? 'recipe' : method === 'email' ? 'email' : 'form']++;
      created++;
    }
  });
  insert(brokers);

  getDb().prepare('UPDATE campaign SET total = ? WHERE id = ?').run(created, id);
  log.info('campagne créée', { total: created, ignores: skipped });
  bus.emit('campaign', { id, total: created });

  return { id, total: created, skipped, skippedReasons, byMethod };
}

export function listCampaigns() {
  return getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM request r WHERE r.campaign_id = c.id) AS requests,
      (SELECT COUNT(*) FROM request r WHERE r.campaign_id = c.id AND r.status IN ('completed','no_data')) AS done,
      (SELECT COUNT(*) FROM request r WHERE r.campaign_id = c.id AND r.status IN ('queued','in_progress')) AS pending
    FROM campaign c ORDER BY c.created_at DESC LIMIT 50
  `).all() as Record<string, unknown>[];
}

/**
 * Clôt les campagnes dont plus aucune demande n'attend d'envoi.
 *
 * Rien ne fermait une campagne: les huit campagnes de la première utilisation
 * réelle affichaient encore « en cours » le lendemain, y compris celles d'une
 * seule demande, aboutie depuis longtemps. Une campagne est terminée quand elle
 * n'a plus rien à envoyer; les réponses des courtiers, elles, continuent
 * d'arriver et de faire évoluer chaque demande.
 */
export function closeFinishedCampaigns(): number {
  const rows = getDb().prepare(`
    SELECT id FROM campaign WHERE status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM request r
        WHERE r.campaign_id = campaign.id AND r.status IN ('queued','in_progress')
      )
  `).all() as { id: string }[];
  for (const row of rows) {
    getDb().prepare("UPDATE campaign SET status = 'done', finished_at = ? WHERE id = ? AND status = 'running'")
      .run(nowIso(), row.id);
    bus.emit('campaign', { id: row.id, status: 'done' });
  }
  if (rows.length) log.info('campagnes terminées', { nombre: rows.length });
  return rows.length;
}

/**
 * Remet en file les demandes qu'aucun travail ne reprend.
 *
 * Une demande « en attente » sans travail associé n'avance plus jamais: elle
 * reste affichée comme programmée alors que rien ne la porte. Trois causes
 * connues: un travail clos à tort (corrigé dans queue.ts), une purge de la file
 * après sept jours, une fermeture pendant l'exécution.
 *
 * La réparation est passive et sans effet de bord: on ne renvoie rien qui soit
 * déjà parti (`sent_at` renseigné), et le travail choisi est celui qu'une
 * campagne aurait créé pour cette demande.
 */
export function recoverStuckRequests(): number {
  const pending = requestIdsWithPendingJob();
  const rows = getDb().prepare(`
    SELECT * FROM request
    WHERE status IN ('queued','in_progress') AND sent_at IS NULL
  `).all() as RequestRow[];

  /**
   * Demandes rendues à l'utilisateur faute d'adresse, alors qu'on en a une.
   *
   * Le cas de la version 1.0: la recherche trouvait l'adresse sur le site du
   * courtier, l'envoi ne la voyait pas, et la demande partait en « action
   * requise » avec « ce courtier n'accepte pas les demandes par email ». 151
   * demandes sur 403 étaient dans cet état, toutes avec une adresse
   * parfaitement utilisable.
   *
   * Trois conditions, volontairement strictes: rien n'est jamais parti pour
   * cette demande, aucun message n'a été échangé, et le courtier a maintenant
   * une adresse. Un captcha, une pièce d'identité réclamée ou un formulaire
   * exigé par le courtier surviennent toujours après un envoi: `sent_at`
   * renseigné les exclut tous.
   */
  const rendues = getDb().prepare(`
    SELECT * FROM request
    WHERE status = 'action_required' AND sent_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM message m WHERE m.request_id = request.id)
  `).all() as RequestRow[];

  for (const request of rendues) {
    if (pending.has(request.id)) continue;
    const broker = getBroker(request.broker_id);
    if (!broker) continue;

    if (broker.email && getSetting('automation').emailEnabled) {
      addEvent(request.id, 'discovered', `Une adresse utilisable est maintenant connue: ${broker.email}`);
      updateRequest(request.id, { method: 'email', status: 'queued', last_error: null });
      rows.push({ ...request, method: 'email', status: 'queued' });
      continue;
    }

    // Ni adresse ni formulaire, et rien n'est jamais parti: il n'y a pas
    // d'action, seulement une société qui ne publie aucun contact. Les 204
    // demandes de la version 1.0 rangées ici encombraient la liste des actions
    // sans que personne ne puisse rien en faire.
    if (!broker.optOutUrl) {
      setStatus(request.id, 'unreachable', 'Cette société ne publie aucun moyen de la joindre.', {
        url: broker.privacyUrl ?? broker.website,
      });
    }
  }

  const automation = getSetting('automation');
  let recovered = 0;

  for (const request of rows) {
    if (pending.has(request.id)) continue;
    const broker = getBroker(request.broker_id);
    if (!broker) continue;

    let kind: 'send_email' | 'run_recipe' | 'submit_form' | 'discover_contact' | null = null;
    if (request.method === 'email' && broker.email) kind = 'send_email';
    else if (request.method === 'recipe' && getRecipe(broker.recipe) && browserStatus().available) kind = 'run_recipe';
    else if (broker.email && automation.emailEnabled) kind = 'send_email';
    else if (broker.optOutUrl && automation.autoSubmitForms && browserStatus().available) kind = 'submit_form';
    else if (!broker.email && !broker.optOutUrl && broker.website && browserStatus().available) kind = 'discover_contact';

    if (!kind) {
      // Rien d'automatisable. Avec un formulaire connu, la demande revient à
      // l'utilisateur; sans rien, elle rejoint les injoignables plutôt que de
      // rester indéfiniment « en attente » sans que rien ne la porte.
      if (broker.optOutUrl) {
        setStatus(request.id, 'action_required', 'Formulaire à remplir sur le site du courtier.', { url: broker.optOutUrl });
      } else {
        setStatus(request.id, 'unreachable', 'Cette société ne publie aucun moyen de la joindre.', {
          url: broker.privacyUrl ?? broker.website,
        });
      }
      continue;
    }

    if (kind === 'send_email' && request.method !== 'email') updateRequest(request.id, { method: 'email', status: 'queued' });
    else if (request.status !== 'queued') updateRequest(request.id, { status: 'queued' });

    enqueue(kind, { requestId: request.id }, { priority: kind === 'discover_contact' ? 120 : 100 - Math.min(99, broker.score) });
    recovered++;
  }

  if (recovered) log.info('demandes remises en file', { nombre: recovered });
  return recovered;
}

// ---------------------------------------------------------------------------
// Gestionnaires de travaux
// ---------------------------------------------------------------------------

/**
 * Un délai nul, ou négatif, veut dire « jamais ».
 *
 * C'est la lecture que fait n'importe qui en tapant 0 dans « Relance après
 * (jours) ». Le code faisait l'inverse: `jours >= 0` est vrai dès le premier
 * instant, si bien que 0 déclenchait l'envoi immédiat, et 0 dans « Mise en
 * demeure après » expédiait dans la seconde le courrier annonçant la saisine de
 * l'autorité de contrôle. Un réglage ne doit jamais faire le contraire de ce
 * qu'il dit.
 */
function relanceActive(jours: number): boolean {
  return Number.isFinite(jours) && jours > 0;
}

/** Date du prochain geste automatique, ou null si l'utilisateur n'en veut aucun. */
function prochaineEcheance(schedule: ScheduleSettings): string | null {
  const delais = [schedule.followUpAfterDays, schedule.escalateAfterDays].filter(relanceActive);
  return delais.length ? addDays(Math.min(...delais)) : null;
}

/**
 * Programme le suivi d'une demande partie, s'il y a un suivi à programmer.
 *
 * Relance et mise en demeure toutes deux désactivées: aucun travail n'est mis
 * en file. Sans cela, un travail serait créé pour ne rien faire, puis se
 * replanifierait indéfiniment.
 */
function planifierSuivi(requestId: string, schedule: ScheduleSettings): void {
  const echeance = prochaineEcheance(schedule);
  if (!echeance) return;
  enqueue('follow_up', { requestId }, { runAfter: echeance, dedupeKey: `followup:${requestId}` });
}

/** Prochaine fenêtre d'envoi quand la limite quotidienne est atteinte. */
function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

async function handleSendEmail(job: Job): Promise<void> {
  const requestId = String(job.payload.requestId);
  const request = getRequest(requestId);
  if (!request || request.status === 'skipped') return;

  const broker = getBroker(request.broker_id);
  const profile = getProfile();
  if (!broker || !profile) throw new Error('courtier ou profil introuvable');
  if (!broker.email) {
    // Deux situations très différentes: le courtier n'a jamais publié
    // d'adresse, ou celle qu'il publiait rebondit. Les confondre laissait
    // l'utilisateur croire à un choix du courtier alors que c'est une panne.
    const rebond = isContactDead(request.broker_id);
    // Sans adresse et sans formulaire, il n'y a aucune action à proposer: la
    // demande est injoignable, pas en attente de l'utilisateur.
    if (!broker.optOutUrl) {
      setStatus(
        requestId,
        'unreachable',
        rebond
          ? "L'adresse de cette société rebondit et elle n'en publie aucune autre."
          : 'Cette société ne publie aucun moyen de la joindre.',
        { url: broker.privacyUrl ?? broker.website },
      );
      return;
    }
    setStatus(
      requestId,
      'action_required',
      rebond
        ? "L'adresse connue de ce courtier rebondit: passez par son formulaire."
        : "Ce courtier n'accepte pas les demandes par email.",
      { url: broker.optOutUrl },
    );
    return;
  }

  const automation = getSetting('automation');
  if (emailsSentToday() >= automation.dailyEmailLimit) {
    // On ne consomme pas la tentative: c'est une pause, pas un échec.
    getDb().prepare("UPDATE job SET status = 'queued', run_after = ? WHERE id = ?").run(tomorrowMorning(), job.id);
    // Une seule mention tant que la demande n'a pas bougé. Une campagne d'un
    // millier d'envois est reportée chaque jour jusqu'à son tour: en inscrire
    // la trace à chaque fois remplissait la chronologie de lignes identiques,
    // au point de noyer l'historique réel de la demande.
    const dernier = getDb()
      .prepare('SELECT type FROM request_event WHERE request_id = ? ORDER BY at DESC, id DESC LIMIT 1')
      .get(requestId) as { type: string } | undefined;
    if (dernier?.type !== 'throttled') {
      addEvent(requestId, 'throttled', `Limite quotidienne atteinte (${automation.dailyEmailLimit} envois). Reprise dès que possible.`);
    }
    throw new SilentReschedule();
  }

  updateRequest(requestId, { status: 'in_progress', attempts: request.attempts + 1 });

  const mail = renderMail({ broker, profile, token: request.token, kind: 'initial' });
  const result = await sendMail({ to: broker.email, subject: mail.subject, text: mail.text, token: request.token });

  if (result.rejected.length) throw new Error(`destinataire refuse: ${result.rejected.join(', ')}`);

  addMessage({
    requestId,
    direction: 'out',
    subject: mail.subject,
    from: getSetting('smtp').fromEmail || getSetting('smtp').user,
    to: broker.email,
    body: result.raw,
    messageId: result.messageId,
  });

  const schedule = getSetting('schedule');
  updateRequest(requestId, {
    status: 'sent',
    sent_at: nowIso(),
    message_id: result.messageId,
    next_action_at: prochaineEcheance(schedule),
    deadline_at: addDays(30),
  });
  addEvent(requestId, 'sent', `Demande envoyée à ${broker.email}`, { legalBasis: mail.legalBasis });
  planifierSuivi(requestId, schedule);
}

async function handleRunRecipe(job: Job): Promise<void> {
  const requestId = String(job.payload.requestId);
  const request = getRequest(requestId);
  if (!request) return;

  const broker = getBroker(request.broker_id);
  const profile = getProfile();
  if (!broker || !profile) throw new Error('courtier ou profil introuvable');

  const recipe = getRecipe(broker.recipe);
  if (!recipe) {
    setStatus(requestId, 'action_required', "Aucune recette d'automatisation pour ce courtier.", { url: broker.optOutUrl });
    return;
  }

  updateRequest(requestId, { status: 'in_progress', attempts: request.attempts + 1 });
  const result = await runRecipe({ recipe, broker, profile, requestId, headed: Boolean(job.payload.headed) });
  if (result.screenshot) addArtifact(requestId, 'screenshot', result.screenshot);

  switch (result.outcome) {
    case 'submitted': {
      const schedule = getSetting('schedule');
      updateRequest(requestId, { status: recipe.confirmByEmail ? 'awaiting_reply' : 'sent', sent_at: nowIso(), next_action_at: prochaineEcheance(schedule) });
      addEvent(requestId, 'submitted', result.message, { url: result.finalUrl });
      planifierSuivi(requestId, schedule);
      break;
    }
    case 'not_found':
      setStatus(requestId, 'no_data', "Aucune fiche à votre nom sur ce site.", { url: result.finalUrl });
      break;
    case 'captcha':
      setStatus(requestId, 'action_required', result.message, { url: result.manualUrl, reason: 'captcha' });
      break;
    case 'selector_missing':
      // Repli utile: si le courtier accepte aussi l'email, on bascule plutôt
      // que d'abandonner la demande.
      if (broker.email) {
        addEvent(requestId, 'fallback', 'Formulaire modifié: bascule sur une demande par email.');
        updateRequest(requestId, { method: 'email', status: 'queued' });
        enqueue('send_email', { requestId });
      } else {
        setStatus(requestId, 'action_required', result.message, { url: result.manualUrl, reason: 'formulaire modifié' });
      }
      break;
    default:
      setStatus(requestId, 'action_required', result.message, { url: result.manualUrl, reason: 'échec automatisation' });
  }
}

async function handleConfirmLink(job: Job): Promise<void> {
  const requestId = String(job.payload.requestId);
  const url = String(job.payload.url);
  const sender = job.payload.sender ? String(job.payload.sender) : undefined;
  const request = getRequest(requestId);
  if (!request) return;

  const broker = getBroker(request.broker_id);
  if (!broker) throw new Error('courtier introuvable');

  const result = await followConfirmationLink({ url, broker, requestId, senderAddress: sender });
  if (result.screenshot) addArtifact(requestId, 'screenshot', result.screenshot);

  if (result.confirmed) {
    setStatus(requestId, 'confirmed', `Confirmation validée automatiquement. ${result.message}`);
    updateRequest(requestId, { next_action_at: prochaineEcheance(getSetting('schedule')) });
  } else {
    setStatus(requestId, 'action_required', result.message, { url, reason: 'confirmation à valider' });
  }
}

async function handleFollowUp(job: Job): Promise<void> {
  const requestId = String(job.payload.requestId);
  const request = getRequest(requestId);
  if (!request) return;

  // Une demande déjà aboutie ou abandonnée n'a plus besoin de relance. Une
  // société injoignable non plus: rien n'est parti, il n'y a rien à relancer.
  if (['completed', 'no_data', 'rejected', 'failed', 'skipped', 'unreachable'].includes(request.status)) return;

  const broker = getBroker(request.broker_id);
  const profile = getProfile();
  if (!broker || !profile || !broker.email) return;

  const schedule = getSetting('schedule');
  const relance = relanceActive(schedule.followUpAfterDays);
  const demeure = relanceActive(schedule.escalateAfterDays);
  if (!relance && !demeure) return;

  const sentAt = request.sent_at ? new Date(request.sent_at) : new Date(request.created_at);
  const days = Math.floor((Date.now() - sentAt.getTime()) / 86_400_000);

  const alreadyEscalated = (getDb().prepare("SELECT COUNT(*) AS n FROM request_event WHERE request_id = ? AND type = 'escalation'").get(requestId) as { n: number }).n > 0;

  if (demeure && days >= schedule.escalateAfterDays && !alreadyEscalated) {
    const mail = renderMail({ broker, profile, token: request.token, kind: 'escalation', daysElapsed: days });
    const result = await sendMail({ to: broker.email, subject: mail.subject, text: mail.text, token: request.token, inReplyTo: request.message_id ?? undefined });
    addMessage({ requestId, direction: 'out', subject: mail.subject, from: getSetting('smtp').user, to: broker.email, body: result.raw, messageId: result.messageId });
    addEvent(requestId, 'escalation', `Mise en demeure envoyée après ${days} jours sans réponse.`);
    updateRequest(requestId, { status: 'action_required', next_action_at: null });
    notify('warn', `${broker.name} n'a pas répondu en ${days} jours: une plainte est possible.`);
    return;
  }

  const alreadyFollowedUp = (getDb().prepare("SELECT COUNT(*) AS n FROM request_event WHERE request_id = ? AND type = 'followup'").get(requestId) as { n: number }).n > 0;
  if (relance && days >= schedule.followUpAfterDays && !alreadyFollowedUp) {
    const mail = renderMail({ broker, profile, token: request.token, kind: 'followup', daysElapsed: days });
    const result = await sendMail({ to: broker.email, subject: mail.subject, text: mail.text, token: request.token, inReplyTo: request.message_id ?? undefined });
    addMessage({ requestId, direction: 'out', subject: mail.subject, from: getSetting('smtp').user, to: broker.email, body: result.raw, messageId: result.messageId });
    addEvent(requestId, 'followup', `Relance envoyée après ${days} jours sans réponse.`);
    // Sans mise en demeure, la relance est le dernier geste: rien à replanifier.
    if (!demeure) {
      updateRequest(requestId, { next_action_at: null });
      return;
    }
    const versDemeure = Math.max(1, schedule.escalateAfterDays - schedule.followUpAfterDays);
    updateRequest(requestId, { next_action_at: addDays(versDemeure) });
    enqueue('follow_up', { requestId }, { runAfter: addDays(versDemeure), dedupeKey: `escalate:${requestId}` });
    return;
  }

  // Trop tôt: on repousse à la prochaine échéance réellement prévue.
  const prochaine = [
    relance && !alreadyFollowedUp ? schedule.followUpAfterDays : null,
    demeure && !alreadyEscalated ? schedule.escalateAfterDays : null,
  ].filter((d): d is number => d != null && d > days);
  if (!prochaine.length) return;

  const wait = Math.max(1, Math.min(...prochaine) - days);
  enqueue('follow_up', { requestId }, { runAfter: addDays(wait), dedupeKey: `followup-retry:${requestId}` });
}

/** Erreur interne signalant un report volontaire, sans compter comme un échec. */
class SilentReschedule extends Error {
  constructor() {
    super('report volontaire');
    this.name = 'SilentReschedule';
  }
}

export function registerCampaignHandlers(): void {
  registerHandler('send_email', async (job) => {
    try {
      await handleSendEmail(job);
    } catch (err) {
      if ((err as Error).name === 'SilentReschedule') return;
      const requestId = String(job.payload.requestId);
      addEvent(requestId, 'error', `Échec d'envoi: ${(err as Error).message}`);
      updateRequest(requestId, { last_error: (err as Error).message.slice(0, 300) });
      if (job.attempts + 1 >= 3) setStatus(requestId, 'failed', `Envoi impossible: ${(err as Error).message}`);
      throw err;
    }
  });

  registerHandler('run_recipe', async (job) => {
    try {
      await handleRunRecipe(job);
    } catch (err) {
      const requestId = String(job.payload.requestId);
      addEvent(requestId, 'error', `Échec du formulaire: ${(err as Error).message}`);
      if (job.attempts + 1 < 2) throw err;

      // Une recette peut échouer pour des raisons qui n'ont rien à voir avec
      // l'utilisateur: le site a été refondu, son domaine a disparu, il refuse
      // l'automatisation. Plutôt que de lui déposer un message technique, on
      // reprend par la voie suivante. Deux des courtiers concernés lors des
      // premiers essais réels avaient une adresse email parfaitement valable.
      const request = getRequest(requestId);
      const broker = request ? getBroker(request.broker_id) : undefined;
      const automation = getSetting('automation');

      if (broker?.email && automation.emailEnabled) {
        addEvent(requestId, 'fallback', "Formulaire indisponible: la demande repart par email.");
        updateRequest(requestId, { method: 'email', status: 'queued', last_error: null });
        enqueue('send_email', { requestId }, { priority: 20 });
        return;
      }

      if (broker?.optOutUrl && automation.autoSubmitForms && browserStatus().available) {
        addEvent(requestId, 'fallback', 'Recette hors service: tentative de soumission générique du formulaire.');
        updateRequest(requestId, { method: 'form', status: 'queued', last_error: null });
        enqueue('submit_form', { requestId }, { priority: 110 });
        return;
      }

      setStatus(requestId, 'action_required', `Automatisation impossible: ${(err as Error).message}`, {
        url: broker?.optOutUrl,
      });
    }
  });

  /**
   * Cherche un contact sur le site du courtier, puis reprend le cours normal.
   *
   * C'est le rattrapage des courtiers que le robot du catalogue n'a pas pu
   * lire. Si une adresse existe, la demande part par email comme n'importe
   * quelle autre; si seul un portail existe, elle devient un formulaire que
   * l'assistant sait pré-remplir. L'utilisateur n'est prévenu qu'en dernier
   * recours, quand le site ne publie réellement rien.
   */
  registerHandler('discover_contact', async (job) => {
    const requestId = String(job.payload.requestId);
    const request = getRequest(requestId);
    if (!request || request.status === 'skipped') return;

    const broker = getBroker(request.broker_id);
    if (!broker) throw new Error('courtier introuvable');

    // Le statut passe « en cours » ici, quand la recherche démarre vraiment.
    setStatus(requestId, 'in_progress', 'Lecture de la politique de confidentialité du courtier.');

    let found: Awaited<ReturnType<typeof discoverContact>>;
    try {
      found = await discoverContact(broker);
    } catch (err) {
      // Un site qui plante le navigateur laissait la demande figée « en cours »,
      // sans travail pour la reprendre et sans rien dire à l'utilisateur. Elle
      // lui revient avec la page à ouvrir, ce qu'aucune reprise n'aurait donné.
      addEvent(requestId, 'error', `Lecture du site impossible: ${(err as Error).message}`);
      updateRequest(requestId, { last_error: (err as Error).message.slice(0, 300) });
      if (job.attempts + 1 < 2) throw err;
      // Le site refuse la lecture automatique: il n'y a rien de plus à tenter,
      // et rien que l'utilisateur puisse faire de mieux. La demande rejoint les
      // injoignables plutôt que sa liste d'actions.
      setStatus(requestId, 'unreachable', "Le site de cette société refuse toute lecture automatique.", {
        url: broker.privacyUrl ?? broker.website,
      });
      return;
    }

    if (found.email) {
      addEvent(requestId, 'discovered', `Adresse trouvée sur le site du courtier: ${found.email}`, { url: found.sourceUrl });
      updateRequest(requestId, { method: 'email', status: 'queued', last_error: null });
      enqueue('send_email', { requestId }, { priority: 100 - Math.min(99, broker.score) });
      return;
    }

    if (found.optOutUrl) {
      addEvent(requestId, 'discovered', 'Portail de demande trouvé sur le site du courtier.', { url: found.optOutUrl });
      setStatus(requestId, 'action_required', 'Formulaire à remplir sur le site du courtier.', { url: found.optOutUrl });
      return;
    }

    setStatus(
      requestId,
      'unreachable',
      "Cette société ne publie aucun moyen de la joindre: ni adresse, ni formulaire.",
      { url: broker.privacyUrl ?? broker.website },
    );
  });

  /**
   * Remplit et soumet un formulaire d'opt-out sans intervention.
   *
   * Le résultat n'est jamais présenté comme certain: la page de confirmation
   * d'un courtier n'a rien de normalisé. On enregistre donc l'envoi, on garde
   * l'URL finale comme trace, et le suivi ordinaire prend le relais.
   */
  registerHandler('submit_form', async (job) => {
    const requestId = String(job.payload.requestId);
    const request = getRequest(requestId);
    if (!request || request.status === 'skipped') return;

    const broker = getBroker(request.broker_id);
    const profile = getProfile();
    if (!broker || !profile) throw new Error('courtier ou profil introuvable');

    const url = broker.optOutUrl;
    if (!url) {
      setStatus(requestId, 'action_required', "Aucune page d'opt-out connue pour ce courtier.");
      return;
    }

    updateRequest(requestId, { status: 'in_progress', attempts: request.attempts + 1 });
    const result = await submitAutomatically({ broker, profile, url, requestId });

    if (!result.submitted) {
      // La main revient à l'utilisateur, avec la raison exacte: un captcha ne
      // se contourne pas, et une page sans formulaire ne se devine pas.
      setStatus(requestId, 'action_required', `Soumission impossible: ${result.reason}.`, { url });
      return;
    }

    addEvent(requestId, 'submitted', `Formulaire soumis automatiquement (${result.filled.length} champs).`, {
      url: result.finalUrl ?? url,
    });
    updateRequest(requestId, { sent_at: nowIso() });
    setStatus(
      requestId,
      'sent',
      result.reason
        ? "Formulaire soumis. Le site n'a pas affiché de confirmation reconnaissable."
        : 'Formulaire soumis et confirmé par le site.',
      { url: result.finalUrl ?? url },
    );
  });

  registerHandler('confirm_link', handleConfirmLink);
  registerHandler('follow_up', handleFollowUp);
}
