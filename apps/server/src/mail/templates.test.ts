import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderComplaint, renderMail, supervisoryAuthority } from './templates.js';
import type { Broker, Profile } from '../types.js';

const broker: Broker = {
  id: 'acxiom-com',
  name: 'Acxiom',
  domain: 'acxiom.com',
  category: 'marketing',
  regions: ['us', 'eu'],
  email: 'privacy@acxiom.com',
  sources: ['cppa'],
  firstSeen: '2026-01-01',
  methods: ['email'],
  score: 60,
};

const profile: Profile = {
  firstName: 'Marie',
  lastName: 'Dupont',
  emails: ['marie@exemple.fr', 'ancienne@exemple.fr'],
  phones: ['0612345678'],
  addresses: [{ line1: '12 rue des Lilas', city: 'Paris', zip: '75011', country: 'France' }],
  jurisdiction: 'eu',
  language: 'fr',
};

test('la demande francaise invoque le RGPD et cite toutes les adresses', () => {
  const mail = renderMail({ broker, profile, token: 'abc123' });
  assert.equal(mail.legalBasis, 'gdpr');
  assert.match(mail.text, /article 17/i);
  assert.match(mail.text, /marie@exemple\.fr, ancienne@exemple\.fr/);
  assert.match(mail.text, /RB-ABC123/);
  assert.match(mail.text, /30 jours/);
});

test('la demande britannique invoque le UK GDPR', () => {
  const mail = renderMail({ broker, profile: { ...profile, jurisdiction: 'uk', language: 'en' }, token: 'x1' });
  assert.equal(mail.legalBasis, 'ukgdpr');
  assert.match(mail.text, /UK GDPR/);
  assert.match(mail.text, /30 days/);
});

test('la relance mentionne le nombre de jours ecoules', () => {
  const mail = renderMail({ broker, profile, token: 'abc', kind: 'followup', daysElapsed: 31 });
  assert.match(mail.subject, /Relance/);
  assert.match(mail.text, /31 jours/);
});

test('la mise en demeure annonce la saisine de l autorite', () => {
  const mail = renderMail({ broker, profile, token: 'abc', kind: 'escalation', daysElapsed: 46 });
  assert.match(mail.subject, /[Mm]ise en demeure/);
  assert.match(mail.text, /autorité de contrôle/);
});

test('un profil sans adresse postale produit tout de meme une demande valide', () => {
  const mail = renderMail({ broker, profile: { ...profile, addresses: [] }, token: 'abc' });
  assert.match(mail.text, /Marie Dupont/);
  assert.doesNotMatch(mail.text, /undefined/);
});

test('l autorite competente depend de la juridiction', () => {
  assert.match(supervisoryAuthority(profile).name, /CNIL/);
  assert.match(supervisoryAuthority({ ...profile, jurisdiction: 'uk' }).name, /ICO/);
  assert.match(supervisoryAuthority({ ...profile, addresses: [{ line1: '', city: '', zip: '', country: 'Allemagne' }] }).name, /BfDI/);
});

test('le brouillon de plainte reprend la reference et la date', () => {
  const text = renderComplaint({ broker, profile, sentAt: '2026-01-01T00:00:00.000Z', token: 'abc123' });
  assert.match(text, /RB-ABC123/);
  assert.match(text, /Acxiom/);
  assert.match(text, /CNIL/);
});
