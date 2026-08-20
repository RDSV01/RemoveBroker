import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Les contacts trouvés par le navigateur local doivent être visibles depuis le
 * catalogue, sinon la recherche ne sert à rien: en version 1.0, elle trouvait
 * 65 adresses et l'envoi en abandonnait 64, faute de les relire au bon endroit.
 *
 * Symétriquement, une adresse dont on a constaté le rebond doit disparaître de
 * la vue, sinon « Réessayer » réécrit indéfiniment à un destinataire qui
 * n'existe pas.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-catalog-'));
process.env.RB_DATA_DIR = dataDir;

const { openDatabase, getDb } = await import('../db/index.js');
openDatabase();

const { getBroker, loadCatalog, applyDiscoveredContact, catalogStats } = await import('./catalog.js');

/** Le catalogue livré sert de base; on y ajoute un courtier de test. */
loadCatalog();

const SANS_CONTACT = 'rb-test-sans-contact';
getDb().prepare('INSERT INTO custom_broker (id, data) VALUES (?, ?)').run(SANS_CONTACT, JSON.stringify({
  id: SANS_CONTACT, name: 'Test sans contact', domain: 'exemple-test.fr', website: 'https://exemple-test.fr',
  category: 'marketing', regions: ['eu', 'fr'], sources: ['manual'], firstSeen: '2026-08-20',
  methods: ['manual'], score: 50,
}));

const AVEC_EMAIL = 'rb-test-avec-email';
getDb().prepare('INSERT INTO custom_broker (id, data) VALUES (?, ?)').run(AVEC_EMAIL, JSON.stringify({
  id: AVEC_EMAIL, name: 'Test avec email', domain: 'exemple-test2.fr', website: 'https://exemple-test2.fr',
  email: 'dpo@exemple-test2.fr', category: 'marketing', regions: ['eu', 'fr'], sources: ['manual'],
  firstSeen: '2026-08-20', methods: ['email'], score: 50,
}));

loadCatalog();

test('une adresse découverte devient utilisable par l envoi', () => {
  assert.equal(getBroker(SANS_CONTACT)?.email, undefined, 'départ: aucun contact');

  applyDiscoveredContact(SANS_CONTACT, { email: 'privacy@exemple-test.fr' });

  const broker = getBroker(SANS_CONTACT);
  assert.equal(broker?.email, 'privacy@exemple-test.fr');
  assert.ok(broker?.methods.includes('email'), "la méthode 'email' doit apparaître");
  assert.ok(!broker?.methods.includes('manual'), "'manual' n'a plus lieu d'être");
});

test('une adresse découverte n écrase jamais celle du catalogue', () => {
  applyDiscoveredContact(AVEC_EMAIL, { email: 'contact@autre.fr' });
  assert.equal(getBroker(AVEC_EMAIL)?.email, 'dpo@exemple-test2.fr');
});

test('une adresse qui rebondit disparaît de la vue du courtier', () => {
  applyDiscoveredContact(AVEC_EMAIL, { dead: true });

  const broker = getBroker(AVEC_EMAIL);
  assert.equal(broker?.email, undefined, "l'adresse morte ne doit plus être proposée");
  assert.ok(!broker?.methods.includes('email'));
  assert.ok(broker?.methods.length, 'une méthode doit subsister pour rester affichable');
});

test('les contacts découverts comptent dans les courtiers joignables', () => {
  const avant = catalogStats().reachable;
  applyDiscoveredContact(SANS_CONTACT, { email: 'privacy@exemple-test.fr' });
  assert.ok(catalogStats().reachable >= avant, 'le décompte ne doit pas régresser');
  assert.ok(getBroker(SANS_CONTACT)?.email, 'le contact reste appliqué');
});
