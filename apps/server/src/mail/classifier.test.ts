import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classify,
  extractUrls,
  statusForClassification,
  CONCLUSIONS,
  CONFIANCE_MINIMALE,
  type ResponseType,
} from './classifier.js';

/**
 * Ces cas viennent de reponses reelles de courtiers, reecrites sans donnees
 * personnelles. Un courtier mal classe fait perdre une demande: c'est la partie
 * du code qui merite le plus de tests.
 */

test('reconnait une confirmation par lien', () => {
  const result = classify({
    subject: 'Please confirm your opt-out request',
    text: 'Click the link below to confirm your removal request:\nhttps://www.spokeo.com/optout/confirm?token=abc123\nThis link expires in 24 hours.',
  });
  assert.equal(result.type, 'confirmation_required');
  assert.equal(result.confirmUrl, 'https://www.spokeo.com/optout/confirm?token=abc123');
});

test('reconnait une confirmation en francais', () => {
  const result = classify({
    subject: 'Votre demande de suppression',
    text: 'Bonjour,\nCliquez sur le lien ci-dessous pour confirmer votre demande :\nhttps://exemple.fr/valider?id=42',
  });
  assert.equal(result.type, 'confirmation_required');
});

test('reconnait une suppression effectuee', () => {
  const result = classify({
    subject: 'Removal complete',
    text: 'Your personal information has been removed from our database. No further action is required.',
  });
  assert.equal(result.type, 'success');
});

test('reconnait une suppression effectuee en francais', () => {
  const result = classify({
    subject: 'Demande traitee',
    text: 'Vos donnees ont ete supprimees de nos bases. Vous ne figurez plus dans notre annuaire.',
  });
  assert.equal(result.type, 'success');
});

test('reconnait un refus fonde sur une exemption', () => {
  const result = classify({
    subject: 'Re: data deletion request',
    text: 'We are a consumer reporting agency and are exempt from the CCPA deletion requirement.',
  });
  assert.equal(result.type, 'rejected');
});

test('reconnait une absence de donnees', () => {
  const result = classify({
    subject: 'Re: your request',
    text: 'We do not have any record matching the information you provided.',
  });
  assert.equal(result.type, 'no_data');
});

test('reconnait une demande de piece d identite', () => {
  const result = classify({
    subject: 'Identity verification needed',
    text: 'Before we can proceed, please upload a copy of your government-issued ID.',
  });
  assert.equal(result.type, 'id_required');
});

test('reconnait un renvoi vers un formulaire', () => {
  const result = classify({
    subject: 'Privacy request',
    text: 'We do not process requests via email. Please complete the online form at https://example.com/privacy/request-form',
  });
  assert.equal(result.type, 'form_required');
  assert.equal(result.formUrl, 'https://example.com/privacy/request-form');
});

test('reconnait un rebond', () => {
  const result = classify({
    subject: 'Undeliverable: data deletion request',
    from: 'mailer-daemon@googlemail.com',
    text: 'Address not found. Your message wasn\'t delivered to privacy@defunct-broker.com because the address couldn\'t be found.',
  });
  assert.equal(result.type, 'bounced');
});

test('un accuse de reception reste en attente', () => {
  const result = classify({
    subject: 'We received your request',
    text: 'Thank you for contacting us. Your request has been received and assigned ticket #48213. Please allow 30 days.',
  });
  assert.equal(result.type, 'pending');
});

test('une reponse incomprehensible demande une relecture', () => {
  const result = classify({ subject: 'Hello', text: 'Sent from my iPhone' });
  assert.equal(result.type, 'unknown');
  assert.equal(result.needsReview, true);
});

test('un message d absence ne conclut rien', () => {
  const result = classify({
    subject: 'Out of office',
    text: 'I am out of the office until Monday with limited access to email.',
  });
  assert.equal(result.type, 'pending');
});

test('les liens de reseaux sociaux ne sont pas pris pour des confirmations', () => {
  const result = classify({
    subject: 'Confirm your request',
    text: 'Click here to confirm: https://broker.example/confirm/xyz\nFollow us: https://twitter.com/broker https://facebook.com/broker',
  });
  assert.equal(result.confirmUrl, 'https://broker.example/confirm/xyz');
});

test('extractUrls lit les liens HTML et le texte brut', () => {
  const urls = extractUrls('Voir https://a.example/x', '<a href="https://b.example/y">Confirmer</a>');
  assert.deepEqual(urls.map((u) => u.url).sort(), ['https://a.example/x', 'https://b.example/y']);
  assert.equal(urls.find((u) => u.url.includes('b.example'))?.anchor, 'Confirmer');
});

/**
 * Jeu d'épreuve du classement par notions.
 *
 * Chaque cas est écrit dans une formulation volontairement différente des
 * motifs du lexique: c'est le seul moyen de vérifier qu'on reconnaît le sens et
 * non des phrases apprises. Les premiers cas sont des pièges: notre propre
 * demande citée dans la réponse, une négation, un accusé de réception qui
 * mentionne le mot « suppression ».
 */
const NOTRE_SUJET = "Demande d'effacement de données personnelles - Camille Moreau";

const CAS: [string, string, string, string][] = [
  ['pending', NOTRE_SUJET,
    "Nous avons bien reçu votre message et reviendrons vers vous.\n\nLe 12/08/2026, Camille Moreau a écrit :\n> Je vous écris pour exercer mon droit à l'effacement de mes données\n> personnelles, sur le fondement de l'article 17 du RGPD.",
    'notre demande citée sous la réponse'],
  ['success', NOTRE_SUJET,
    'Your data has been deleted.\n\n-----Original Message-----\nFrom: Camille Moreau\nPlease erase all personal data concerning me.',
    'citation après un vrai succès'],
  ['rejected', 'Re: your request', 'We will not delete your data as we are legally required to retain it.', 'négation'],
  ['rejected', 'Re: votre demande', 'Vos données ne seront pas supprimées, nous sommes tenus de les conserver.', 'négation en français'],
  ['pending', 'Re: your request', 'Your request to delete your information has been received and is being reviewed.', 'accusé nommant la demande'],

  ['success', 'Removal complete', 'Your profile is gone from our site as of today.', 'disparition constatée'],
  ['success', 'Demande traitée', "Nous avons procédé à l'effacement des informations vous concernant.", 'périphrase française'],
  ['success', 'Done', 'Done. You will not show up in search results anymore.', 'laconique'],
  ['success', 'Update', 'Your listing has been taken down permanently.', 'taken down'],
  ['success', 'Confirmation', 'This is to confirm the deletion of your personal data from our systems.', 'tournure formelle'],
  ['success', 'Opt-out', 'You have been opted out and de-listed from all our products.', 'de-listed'],

  ['no_data', 'Re: request', 'We searched and came up empty for that name.', 'argot'],
  ['no_data', 'Re: demande', 'Après vérification, rien ne remonte à votre nom dans nos bases.', 'tournure libre'],
  ['no_data', 'Re: request', 'Nothing on file for the email address you provided.', 'nothing on file'],
  ['no_data', 'Re: request', 'We could not locate any record matching the details submitted.', 'could not locate'],

  ['confirmation_required', 'Action needed', 'Follow this link within 48h to finish: https://broker.com/verify?t=abc123', 'lien et délai'],
  ['confirmation_required', 'Verify', 'Please verify your email address to proceed: https://example.com/optout/confirm?id=9', 'vérification adresse'],

  ['id_required', 'Verification', 'Before we proceed, attach a scan of an official document proving who you are.', 'périphrase'],
  ['id_required', 'ID needed', 'Please upload a government-issued photo ID to continue.', 'document officiel'],

  ['form_required', 'Re: request', 'Requests are only handled through the privacy portal: https://x.com/privacy-request', 'portail'],
  ['form_required', 'Re: demande', "Cette boîte n'est pas surveillée. Passez par notre formulaire dédié.", 'boîte non surveillée'],

  ['rejected', 'Re: request', 'As a consumer reporting agency we are not required to honor this.', 'exemption implicite'],
  ['rejected', 'Re: demande', 'Nous conservons ces données pour un motif légal impératif.', 'motif légal'],

  ['pending', 'Ticket opened', 'Ticket #48219 opened. Someone will look at it.', 'ticket'],
  ['pending', 'Accusé', 'Votre message a bien été enregistré sous la référence AB-7781.', 'référence'],

  ['bounced', 'Undeliverable: Demande', 'Your message could not be delivered. Address not found.', 'rebond'],
  ['pending', 'Automatic reply: Demande', "Je suis absent du bureau jusqu'au 30 août.", 'absence'],
  ['unknown', 'Re: Anfrage', 'Ihre Daten wurden aus unserer Datenbank entfernt.', 'langue non couverte'],
];

for (const [attendu, subject, text, note] of CAS) {
  test(`classement: ${note}`, () => {
    assert.equal(classify({ subject, text }).type, attendu);
  });
}

test('ne conclut jamais a une suppression sur notre propre demande citee', () => {
  const result = classify({
    subject: "Demande d'effacement de données personnelles",
    text: "Bonjour,\n\n> Effacer toutes les données personnelles me concernant de vos bases.\n> Cesser toute vente de ces données.\n\nMerci de votre message.",
  });
  assert.notEqual(result.type, 'success');
});

/**
 * Le classement produisait un statut définitif quelle que soit sa confiance.
 * Sur une campagne réelle, deux réponses jugées « suppression confirmée » à
 * 0,43 et 0,56 ont marqué leur demande terminée: l'utilisateur lisait
 * « données supprimées » sans qu'aucune certitude ne l'appuie. Ces cas sont
 * ceux observés le 19 août 2026.
 */
test('une conclusion peu sûre ne conclut pas à la place de l utilisateur', () => {
  const conclut = (type: ResponseType, confidence: number) =>
    CONCLUSIONS.has(type) && confidence < CONFIANCE_MINIMALE ? 'action_required' : statusForClassification(type);

  assert.equal(conclut('success', 0.43), 'action_required', 'Fandom: 43 % ne vaut pas une suppression confirmée');
  assert.equal(conclut('success', 0.56), 'action_required', 'Teads: 56 % non plus');
  assert.equal(conclut('success', 0.99), 'completed', 'une certitude conclut normalement');
  assert.equal(conclut('no_data', 0.99), 'no_data');
  assert.equal(conclut('rejected', 0.5), 'action_required', 'un refus mal lu prive d une plainte fondée');

  // Les états d'attente laissent la demande ouverte: les bloquer n'apporterait
  // rien et enverrait l'utilisateur relire des accusés de réception.
  assert.equal(conclut('pending', 0.66), 'awaiting_reply');
  assert.equal(conclut('confirmation_required', 0.3), 'awaiting_reply');
});

/**
 * Réponse réelle de Choreograph, 19 août 2026. Aucun numéro de ticket, aucun
 * lien, aucune formule d'accusé de réception habituelle: le message ressortait
 * « indéterminé » et la demande restait sans suite alors qu'elle avançait.
 */
test('une prise en charge sans accusé formel est reconnue', () => {
  const r = classify({
    subject: 'Your request was successfully submitted',
    text: "Choreograph Consumer Preference portal. Your request has been submitted successfully and will be actioned, there is no further action required from you. Please allow up to 30 days to process your request.",
  });
  assert.equal(r.type, 'pending');
  assert.ok(r.confidence >= 0.7, `confiance trop faible: ${r.confidence}`);
});
