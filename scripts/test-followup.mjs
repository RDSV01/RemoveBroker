#!/usr/bin/env node
/**
 *   RB_DATA_DIR=/tmp/essai node scripts/test-followup.mjs
 *
 * Éprouve le chemin des relances et de la mise en demeure.
 *
 * Ce code ne s'exécute chez un utilisateur qu'un mois après sa première
 * campagne: personne ne l'a encore vu tourner. On simule donc le temps en
 * antidatant des demandes, et on capte les envois avec un serveur SMTP local
 * qui jette tout, pour ne déranger aucun courtier.
 */
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// --- serveur SMTP jetable ---------------------------------------------------
const recus = [];
const smtp = net.createServer((socket) => {
  let corps = '';
  let dansDonnees = false;
  socket.write('220 local ESMTP\r\n');
  socket.on('data', (chunk) => {
    const texte = chunk.toString();
    if (dansDonnees) {
      corps += texte;
      if (texte.includes('\r\n.\r\n')) {
        dansDonnees = false;
        recus.push(corps);
        corps = '';
        socket.write('250 OK\r\n');
      }
      return;
    }
    for (const ligne of texte.split('\r\n').filter(Boolean)) {
      const cmd = ligne.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250-local\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) socket.write('235 OK\r\n');
      else if (cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) socket.write('250 OK\r\n');
      else if (cmd.startsWith('DATA')) { dansDonnees = true; socket.write('354 go\r\n'); }
      else if (cmd.startsWith('QUIT')) { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise((r) => smtp.listen(2526, '127.0.0.1', r));

// --- application ------------------------------------------------------------
const charger = (rel) => import(pathToFileURL(path.resolve('apps/server/dist', rel)).href);
const { ensureDirs } = await charger('config/paths.js');
const { openDatabase, getDb, nowIso } = await charger('db/index.js');
const { unlock } = await charger('crypto/keyring.js');
const { loadCatalog } = await charger('core/catalog.js');
const { saveProfile } = await charger('core/profile.js');
const { setSetting } = await charger('core/settings.js');
const { createRequest, updateRequest, listEvents } = await charger('engine/store.js');
const { registerCampaignHandlers } = await charger('engine/campaign.js');
const { runOnce } = await charger('engine/queue.js').catch(() => ({}));

ensureDirs();
openDatabase();
unlock();
loadCatalog();

saveProfile({
  firstName: 'Camille', lastName: 'Moreau', emails: ['camille@example.fr'],
  addresses: [{ line1: '1 rue X', city: 'Lyon', state: '', zip: '69003', country: 'France' }],
  jurisdiction: 'eu', language: 'fr',
});
setSetting('smtp', {
  preset: 'custom', host: '127.0.0.1', port: 2526, secure: false,
  user: 'camille@example.fr', password: 'x', fromName: 'Camille Moreau', fromEmail: 'camille@example.fr',
});

registerCampaignHandlers();
const { runHandlerForTest } = await charger('engine/queue.js');

const scenarios = [
  ['relance a 31 jours', 31, 'followup'],
  ['mise en demeure a 46 jours', 46, 'escalation'],
];

for (const [nom, jours, attendu] of scenarios) {
  const request = createRequest({
    campaignId: null, brokerId: 'criteo-com', brokerName: 'Criteo',
    method: 'email', legalBasis: 'gdpr', deadlineDays: 30,
  });
  const date = new Date(Date.now() - jours * 86_400_000).toISOString();
  updateRequest(request.id, { status: 'sent', sent_at: date });
  getDb().prepare('UPDATE request SET created_at = ? WHERE id = ?').run(date, request.id);

  const avant = recus.length;
  await runHandlerForTest('follow_up', { requestId: request.id });
  const evenements = listEvents(request.id).map((e) => e.type);
  const envoye = recus.length > avant;
  const ok = evenements.includes(attendu) && envoye;
  console.log(`${ok ? 'ok  ' : 'ECHEC'} ${nom.padEnd(28)} evenements=${evenements.join(',')} envoi=${envoye ? 'oui' : 'non'}`);
  if (envoye) {
    const sujet = /Subject: (.+)/.exec(recus[recus.length - 1])?.[1] ?? '';
    console.log(`     sujet: ${sujet.slice(0, 78)}`);
  }
}

smtp.close();
process.exit(0);
