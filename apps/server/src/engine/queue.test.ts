import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Un travail qui ne se termine jamais immobilisait un emplacement d'exécution
 * pour toujours: la concurrence tombait sans qu'aucune erreur n'apparaisse, et
 * la demande restait figée en `in_progress`, ni envoyée, ni en échec, invisible
 * pour toute relance. Constaté sur une campagne réelle le 19 août 2026, quatre
 * demandes bloquées depuis cinq heures.
 *
 * Ces deux tests verrouillent les garde-fous ajoutés en réponse.
 */

// Le module lit paths.database au chargement: la variable doit être posée avant.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-queue-'));
process.env.RB_DATA_DIR = dataDir;

const { openDatabase, getDb, nowIso } = await import('../db/index.js');
const { registerHandler, enqueue, startQueue, stopQueue, queueStatus, setJobTimeoutForTest } =
  await import('./queue.js');

openDatabase();

test('un travail bloqué libère son emplacement au lieu de le retenir', async () => {
  setJobTimeoutForTest(300);
  // Ne se résout jamais: exactement le cas du navigateur qui ne démarre pas.
  registerHandler('discover_contact', () => new Promise<void>(() => {}));

  enqueue('discover_contact', { requestId: 'bloque' });
  startQueue();

  try {
    // La file examine les travaux toutes les secondes: il faut ce délai, puis
    // celui de l'abandon, avant que l'emplacement soit rendu.
    await new Promise((r) => setTimeout(r, 2500));
    const apres = queueStatus();
    assert.equal(apres.inFlight, 0, "l'emplacement doit avoir été rendu");
    assert.ok(
      (apres.counts.queued ?? 0) + (apres.counts.failed ?? 0) > 0,
      'le travail doit repartir en file ou être marqué en échec, pas disparaître',
    );
  } finally {
    // Sans cela, un échec ici laisserait la file démarrée et ferait sortir le
    // test suivant par son garde `if (running) return`.
    stopQueue();
    setJobTimeoutForTest(5 * 60_000);
  }
});

test('une demande interrompue repart en file au démarrage', () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO request (id, broker_id, broker_name, method, status, token, created_at, updated_at)
    VALUES ('fige', 'exemple-fr', 'Exemple', 'form', 'in_progress', 'jeton1234', ?, ?)
  `).run(nowIso(), nowIso());

  // Une demande déjà partie ne doit surtout pas être renvoyée.
  db.prepare(`
    INSERT INTO request (id, broker_id, broker_name, method, status, token, sent_at, created_at, updated_at)
    VALUES ('envoye', 'exemple2-fr', 'Exemple 2', 'email', 'in_progress', 'jeton5678', ?, ?, ?)
  `).run(nowIso(), nowIso(), nowIso());

  startQueue();
  stopQueue();

  const fige = db.prepare("SELECT status FROM request WHERE id = 'fige'").get() as { status: string };
  const envoye = db.prepare("SELECT status FROM request WHERE id = 'envoye'").get() as { status: string };
  assert.equal(fige.status, 'queued', 'la demande jamais envoyée doit repartir');
  assert.equal(envoye.status, 'in_progress', 'une demande déjà envoyée ne doit pas être renvoyée');
});
