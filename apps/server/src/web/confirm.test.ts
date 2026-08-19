import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLinkSafe } from './confirm.js';
import type { Broker } from '../types.js';

/**
 * Ouvrir un lien reçu par email est l'opération la plus risquée du programme.
 * Ces tests verrouillent la regle: seul le domaine du courtier, ou un
 * prestataire reconnu, est ouvert automatiquement.
 */

const broker: Broker = {
  id: 'spokeo-com',
  name: 'Spokeo',
  domain: 'spokeo.com',
  website: 'https://www.spokeo.com/',
  category: 'people-search',
  regions: ['us'],
  email: 'privacy@spokeo.com',
  sources: ['optery'],
  firstSeen: '2026-01-01',
  methods: ['email'],
  score: 100,
};

test('accepte un lien du domaine du courtier', () => {
  assert.equal(isLinkSafe('https://www.spokeo.com/optout/confirm?t=1', broker).safe, true);
});

test('accepte un sous-domaine du courtier', () => {
  assert.equal(isLinkSafe('https://links.spokeo.com/c/abc', broker).safe, true);
});

test('accepte un prestataire de gestion des droits reconnu', () => {
  assert.equal(isLinkSafe('https://privacyportal.onetrust.com/webform/x', broker).safe, true);
});

test('refuse un domaine tiers', () => {
  const verdict = isLinkSafe('https://spokeo.evil-mirror.example/confirm', broker);
  assert.equal(verdict.safe, false);
  assert.match(verdict.reason, /domaine inattendu/);
});

test('refuse un lien non chiffre', () => {
  assert.equal(isLinkSafe('http://www.spokeo.com/optout', broker).safe, false);
});

test('refuse une URL illisible', () => {
  assert.equal(isLinkSafe('pas une url', broker).safe, false);
});

test('accepte le domaine de l expediteur quand il correspond au message', () => {
  const verdict = isLinkSafe('https://mail-service.example/confirm', broker, 'noreply@mail-service.example');
  assert.equal(verdict.safe, true);
});
