import { keyringStatus } from '../crypto/keyring.js';
import { getSetting } from '../core/settings.js';
import { createLogger } from '../util/logger.js';
import { registerCampaignHandlers } from './campaign.js';
import { registerSchedulerHandlers, startScheduler, stopScheduler } from './scheduler.js';
import { setConcurrency, startQueue, stopQueue } from './queue.js';

const log = createLogger('moteur');

/**
 * Démarrage et arrêt du moteur, séparés du serveur HTTP.
 *
 * Le moteur ne peut pas tourner tant que le coffre est verrouillé: il lirait
 * des réglages chiffrés. L'interface appelle donc startEngine() juste après un
 * déverrouillage réussi.
 */

let started = false;

export function startEngine(): boolean {
  if (started) return true;
  if (!keyringStatus().unlocked) return false;

  registerCampaignHandlers();
  registerSchedulerHandlers();
  setConcurrency(getSetting('automation').concurrency);
  startQueue();
  startScheduler();
  started = true;
  log.info('moteur démarre');
  return true;
}

export function stopEngine(): void {
  if (!started) return;
  stopScheduler();
  stopQueue();
  started = false;
}

export function engineRunning(): boolean {
  return started;
}
