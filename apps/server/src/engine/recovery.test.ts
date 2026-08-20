import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

/**
 * La liste des actions ne doit contenir que ce que l'utilisateur peut résoudre.
 *
 * En version 1.0 elle en comptait 403 sur 1 977 demandes: 151 attendaient une
 * adresse qui était déjà connue, et 204 annonçaient « la démarche est à trouver
 * sur son site » pour des sociétés qui ne publient rien. Restaient 48 actions
 * réelles, noyées dans le lot.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-recovery-'));
process.env.RB_DATA_DIR = dataDir;
process.env.RB_LOG_FILE = '0';

const { openDatabase, getDb, nowIso } = await import('../db/index.js');
openDatabase();

// Les réglages sont chiffrés: sans clé, setSetting échoue avant le premier test.
const { unlock } = await import('../crypto/keyring.js');
unlock();

const { loadCatalog, applyDiscoveredContact } = await import('../core/catalog.js');
const { setSetting } = await import('../core/settings.js');
const { recoverStuckRequests } = await import('./campaign.js');
const { requestStats } = await import('./store.js');

setSetting('automation', { emailEnabled: true, webEnabled: false, autoSubmitForms: false });

/** Trois courtiers de test, un par situation. */
const COURTIERS = [
  { id: 'rb-r-decouvert', name: 'Contact découvert', domain: 'a-test.fr', website: 'https://a-test.fr' },
  { id: 'rb-r-injoignable', name: 'Sans contact', domain: 'b-test.fr', website: 'https://b-test.fr' },
  { id: 'rb-r-formulaire', name: 'Formulaire connu', domain: 'c-test.fr', website: 'https://c-test.fr', optOutUrl: 'https://c-test.fr/optout' },
];
for (const b of COURTIERS) {
  getDb().prepare('INSERT INTO custom_broker (id, data) VALUES (?, ?)').run(b.id, JSON.stringify({
    ...b, category: 'marketing', regions: ['eu'], sources: ['manual'], firstSeen: '2026-08-20',
    methods: b.optOutUrl ? ['form'] : ['manual'], score: 50,
  }));
}
loadCatalog();

/** Demande rendue à l'utilisateur, jamais envoyée, sans échange. */
function demandeRendue(id: string, brokerId: string, nom: string): void {
  getDb().prepare(`
    INSERT INTO request (id, broker_id, broker_name, method, status, token, created_at, updated_at)
    VALUES (?, ?, ?, 'email', 'action_required', ?, ?, ?)
  `).run(id, brokerId, nom, id.slice(0, 10), nowIso(), nowIso());
}

demandeRendue('req-decouvert', 'rb-r-decouvert', 'Contact découvert');
demandeRendue('req-injoignable', 'rb-r-injoignable', 'Sans contact');
demandeRendue('req-formulaire', 'rb-r-formulaire', 'Formulaire connu');

// Une demande partie, dont la réponse réclame une pièce d'identité: elle doit
// rester une action, quoi qu'il arrive.
getDb().prepare(`
  INSERT INTO request (id, broker_id, broker_name, method, status, token, sent_at, created_at, updated_at)
  VALUES ('req-identite', 'rb-r-decouvert', 'Contact découvert', 'email', 'action_required', 'jetonid12', ?, ?, ?)
`).run(nowIso(), nowIso(), nowIso());

// L'adresse a été trouvée sur le site depuis: c'est le cas des 151.
applyDiscoveredContact('rb-r-decouvert', { email: 'privacy@a-test.fr' });

recoverStuckRequests();

const statut = (id: string) => (getDb().prepare('SELECT status FROM request WHERE id = ?').get(id) as { status: string }).status;

test('une demande rendue faute d adresse repart dès qu on en connaît une', () => {
  assert.equal(statut('req-decouvert'), 'queued');
});

test('une société sans aucun contact sort de la liste des actions', () => {
  assert.equal(statut('req-injoignable'), 'unreachable');
});

test('un formulaire connu reste une action: l utilisateur peut le remplir', () => {
  assert.equal(statut('req-formulaire'), 'action_required');
});

test('une demande déjà partie n est jamais renvoyée par la reprise', () => {
  assert.equal(statut('req-identite'), 'action_required');
});

test('les injoignables ne sont pas comptées comme des actions', () => {
  const s = requestStats();
  assert.equal(s.actionRequired, 2, 'formulaire + pièce d identité');
  assert.equal(s.unreachable, 1);
});
