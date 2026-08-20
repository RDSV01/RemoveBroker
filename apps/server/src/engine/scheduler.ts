import { addDays, getDb, nowIso } from '../db/index.js';
import { allBrokers, getBroker, updateCatalog } from '../core/catalog.js';
import { getSetting } from '../core/settings.js';
import { createLogger } from '../util/logger.js';
import { pollInbox } from '../mail/imap.js';
import { statusForClassification, CONCLUSIONS, CONFIANCE_MINIMALE } from '../mail/classifier.js';
import { notify } from './bus.js';
import { enqueue, pruneJobs, registerHandler } from './queue.js';
import { addEvent, addMessage, setStatus, updateRequest } from './store.js';
import { closeFinishedCampaigns, createCampaign } from './campaign.js';
import { forgetDiscoveredContact } from '../web/discover.js';

const log = createLogger('scheduler');

/**
 * Tâches récurrentes.
 *
 * Trois rythmes: la boîte de réception toutes les dix minutes (c'est ce qui
 * fait avancer les demandes sans intervention), le catalogue une fois par jour,
 * et le balayage des nouveaux courtiers selon la période choisie.
 */

const MINUTE = 60_000;
let timers: NodeJS.Timeout[] = [];

/** Traité une réponse rattachée: met à jour le statut et déclenche la suite. */
export async function processInbox(): Promise<{ scanned: number; matched: number }> {
  const automation = getSetting('automation');

  const result = await pollInbox(async ({ request, classification, parsed }) => {
    const sender = parsed.from?.value?.[0]?.address ?? '';

    addMessage({
      requestId: request.id,
      direction: 'in',
      subject: parsed.subject ?? '',
      from: sender,
      to: (parsed.to && !Array.isArray(parsed.to) ? parsed.to.text : '') ?? '',
      body: parsed.text ?? '',
      messageId: String(parsed.messageId ?? ''),
      classification: classification.type,
      confidence: classification.confidence,
    });

    const nextStatus = statusForClassification(classification.type);

    // Une conclusion tirée d'un classement peu sûr est pire qu'une absence de
    // conclusion: l'utilisateur lit « suppression confirmée » et n'y revient
    // jamais. Sous le seuil, la réponse lui est présentée telle quelle et
    // c'est lui qui tranche. Les états d'attente ne sont pas concernés: ils
    // laissent la demande ouverte de toute façon.
    //
    // `needsReview` complète le seuil: il signale une catégorie disputée, que
    // la confiance seule ne rattrape pas toujours.
    if (CONCLUSIONS.has(classification.type)
      && (classification.confidence < CONFIANCE_MINIMALE || classification.needsReview)) {
      setStatus(
        request.id,
        'action_required',
        `Réponse reçue, mais son sens n'est pas certain. À lire pour trancher.`,
        { reason: classification.reason, suppose: classification.type, confiance: classification.confidence },
      );
      addEvent(request.id, 'reply', `Classement incertain (${Math.round(classification.confidence * 100)} %), la réponse attend votre lecture.`);
      return;
    }

    switch (classification.type) {
      case 'confirmation_required': {
        if (classification.confirmUrl && automation.autoConfirmLinks) {
          addEvent(request.id, 'reply', `Le courtier demande une confirmation. Ouverture automatique du lien.`, { reason: classification.reason });
          enqueue('confirm_link', { requestId: request.id, url: classification.confirmUrl, sender }, { priority: 10 });
        } else {
          setStatus(request.id, 'action_required', 'Un lien de confirmation doit être validé.', { url: classification.confirmUrl, reason: classification.reason });
        }
        break;
      }
      case 'success':
        setStatus(request.id, 'completed', 'Le courtier a confirmé la suppression de vos données.', { reason: classification.reason });
        notify('info', `Suppression confirmée chez ${request.broker_name}.`);
        break;
      case 'no_data':
        setStatus(request.id, 'no_data', "Le courtier déclare ne détenir aucune donnée vous concernant.", { reason: classification.reason });
        break;
      case 'rejected':
        setStatus(request.id, 'rejected', 'Demande refusée par le courtier.', { reason: classification.reason });
        break;
      case 'id_required':
        setStatus(request.id, 'action_required', "Le courtier demande une pièce d'identité.", { reason: classification.reason, urls: classification.urls });
        break;
      case 'form_required':
        setStatus(request.id, 'action_required', "Le courtier exige le passage par son formulaire en ligne.", { url: classification.formUrl, reason: classification.reason });
        break;
      case 'address_changed': {
        // Le courtier existe toujours, seule l'adresse est morte: c'est une
        // demande à réémettre, pas un échec. On remonte le contact indiqué au
        // lieu de laisser la réponse « indéterminée » sans suite.
        const suite = classification.altEmail
          ? `Le courtier indique une autre adresse: ${classification.altEmail}`
          : 'Le courtier indique une autre voie sur son site.';
        setStatus(request.id, 'action_required', `Cette adresse n'est plus en service. ${suite}`, {
          reason: classification.reason,
          altEmail: classification.altEmail,
          url: classification.urls[0],
        });
        break;
      }
      case 'bounced':
        setStatus(request.id, 'failed', "L'adresse du courtier est invalide (message rejeté).", { reason: classification.reason });
        updateRequest(request.id, { last_error: 'Adresse du courtier invalide (message rejeté).' });
        // L'adresse du catalogue est morte: le contact découvert précédemment,
        // s'il y en avait un, ne vaut plus rien non plus. L'oublier permet à la
        // prochaine tentative de relire le site au lieu de réécrire à une
        // adresse dont on sait déjà qu'elle rebondit.
        forgetDiscoveredContact(request.broker_id);
        break;
      case 'pending':
        updateRequest(request.id, { status: 'awaiting_reply', next_action_at: addDays(getSetting('schedule').followUpAfterDays) });
        addEvent(request.id, 'reply', 'Accusé de réception reçu.', { reason: classification.reason });
        break;
      default:
        addEvent(request.id, 'reply', 'Réponse reçue, classement incertain: à relire.', { reason: classification.reason });
        updateRequest(request.id, { status: 'action_required' });
    }

    // Mémoire par courtier, utilisée par la page Courtiers. Un simple UPDATE ne
    // touchait aucune ligne tant que l'utilisateur n'avait ni masqué ni annoté
    // ce courtier: la table est restée vide pendant toute la première
    // utilisation réelle, et le dernier résultat connu n'y figurait jamais.
    if (nextStatus) {
      getDb().prepare(`
        INSERT INTO broker_state (broker_id, last_status, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(broker_id) DO UPDATE SET last_status = excluded.last_status, updated_at = excluded.updated_at
      `).run(request.broker_id, nextStatus, nowIso());
    }
  });

  if (result.errors.length) log.warn('erreurs pendant le relevé', { nombre: result.errors.length });
  return { scanned: result.scanned, matched: result.matched };
}

/**
 * Crée une campagne pour les courtiers jamais contactés.
 *
 * C'est ce qui rend la protection continue: un courtier ajoute au catalogue la
 * semaine prochaine recevra sa demande sans que l'utilisateur ait à y penser.
 */
export function sweepNewBrokers(): number {
  const contacted = new Set(
    (getDb().prepare('SELECT DISTINCT broker_id FROM request').all() as { broker_id: string }[]).map((r) => r.broker_id),
  );
  const hidden = new Set(
    (getDb().prepare('SELECT broker_id FROM broker_state WHERE hidden = 1').all() as { broker_id: string }[]).map((r) => r.broker_id),
  );

  const newOnes = allBrokers()
    .filter((b) => !contacted.has(b.id) && !hidden.has(b.id))
    .filter((b) => b.email || b.recipe)
    .map((b) => b.id);

  if (!newOnes.length) return 0;

  createCampaign({ scope: 'selection', brokerIds: newOnes });
  getDb().prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run('last_sweep', JSON.stringify({ at: nowIso(), count: newOnes.length }), nowIso());
  notify('info', `${newOnes.length} nouveaux courtiers détectés: demandes envoyées automatiquement.`);
  log.info('balayage des nouveaux courtiers', { nombre: newOnes.length });
  return newOnes.length;
}

export function registerSchedulerHandlers(): void {
  registerHandler('poll_inbox', async () => {
    await processInbox();
  });
  registerHandler('catalog_update', async () => {
    const result = await updateCatalog();
    if (result.added.length) {
      notify('info', `Catalogue mis à jour: ${result.added.length} nouveaux courtiers.`);
      const schedule = getSetting('schedule');
      if (schedule.enabled) {
        const ids = result.added.filter((id) => {
          const b = getBroker(id);
          return b && (b.email || b.recipe);
        });
        if (ids.length) createCampaign({ scope: 'selection', brokerIds: ids });
      }
    }
  });
}

/** Date du dernier balayage des nouveaux courtiers. */
function lastSweepAt(): number {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('last_sweep') as { value: string } | undefined;
  try {
    return row ? new Date((JSON.parse(row.value) as { at: string }).at).getTime() : 0;
  } catch {
    return 0;
  }
}

export function startScheduler(): void {
  stopScheduler();

  // Boîte de réception: c'est le moteur du suivi automatique.
  timers.push(setInterval(() => {
    if (getSetting('imap').enabled) enqueue('poll_inbox', {}, { dedupeKey: 'poll', priority: 20 });
  }, 10 * MINUTE));

  // Catalogue: une fois par jour suffit, les courtiers n'apparaissent pas à la minute.
  timers.push(setInterval(() => {
    if (getSetting('privacy').catalogAutoUpdate) enqueue('catalog_update', {}, { dedupeKey: 'catalog', priority: 200 });
  }, 24 * 60 * MINUTE));

  /**
   * Balayage des courtiers jamais contactés.
   *
   * Le réglage « relancer les nouveaux courtiers tous les N jours » existait
   * dans l'interface et dans les réglages, mais rien ne l'appliquait: seule une
   * mise à jour du catalogue déclenchait des demandes, et un courtier ajouté
   * pendant une panne de connexion n'était jamais rattrapé. Le contrôle horaire
   * est bon marché; c'est la date du dernier passage qui décide.
   */
  timers.push(setInterval(() => {
    const schedule = getSetting('schedule');
    if (!schedule.enabled) return;
    const days = Math.max(1, schedule.sweepEveryDays);
    if (Date.now() - lastSweepAt() < days * 24 * 60 * MINUTE) return;
    sweepNewBrokers();
  }, 60 * MINUTE));

  // Entretien de la base, et clôture des campagnes qui n'ont plus rien à envoyer.
  timers.push(setInterval(() => {
    pruneJobs();
    closeFinishedCampaigns();
  }, 6 * 60 * MINUTE));
  timers.push(setInterval(() => closeFinishedCampaigns(), 5 * MINUTE));

  // Premier passage peu après le démarrage, le temps que l'interface s'ouvre.
  setTimeout(() => {
    if (getSetting('imap').enabled) enqueue('poll_inbox', {}, { dedupeKey: 'poll', priority: 20 });
    if (getSetting('privacy').catalogAutoUpdate) enqueue('catalog_update', {}, { dedupeKey: 'catalog', priority: 200 });
  }, 30_000);

  log.info('planificateur démarre');
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}
