#!/usr/bin/env node
/**
 * Essaie une recette d'automatisation sur le vrai site, en fenêtre visible.
 *
 * Écrire une recette à l'aveugle ne marche jamais: les sélecteurs changent, un
 * bandeau de consentement s'intercale, le bouton d'envoi n'est pas celui qu'on
 * croit. Ce script ouvre un navigateur pilotable avec un profil fictif pour
 * qu'un contributeur voie ce qui se passe.
 *
 *   npm run build
 *   node scripts/test-recipe.mjs spokeo
 *   node scripts/test-recipe.mjs spokeo --envoyer   # va jusqu'à la soumission
 *
 * Sans --envoyer, le formulaire est rempli mais jamais soumis: on peut essayer
 * une recette sans envoyer de demande au nom d'une personne qui n'existe pas.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const recipeId = args.find((a) => !a.startsWith('--'));
const submit = args.includes('--envoyer');

if (!recipeId) {
  console.error('Usage: node scripts/test-recipe.mjs <identifiant-recette> [--envoyer]');
  process.exit(1);
}

const load = (relative) => import(pathToFileURL(path.join(ROOT, 'apps/server/dist', relative)).href);

const { loadCatalog, getRecipe, allBrokers } = await load('core/catalog.js');
const { runRecipe } = await load('web/runner.js');

loadCatalog();

const recipe = getRecipe(recipeId);
if (!recipe) {
  console.error(`Recette inconnue: ${recipeId}`);
  process.exit(1);
}

const broker = allBrokers().find((b) => b.recipe === recipeId)
  ?? { id: recipe.domain, name: recipe.name, domain: recipe.domain, category: 'other', regions: ['us'], methods: ['recipe'], score: 0, sources: [], firstSeen: '' };

/** Profil fictif: aucune donnée réelle ne doit partir pendant un essai. */
const profile = {
  firstName: 'Jean',
  lastName: 'Testeur',
  emails: ['jean.testeur@example.invalid'],
  phones: ['+33 6 00 00 00 00'],
  addresses: [{ line1: '1 rue de l Essai', city: 'Paris', state: '', zip: '75001', country: 'France' }],
  jurisdiction: 'eu',
  language: 'fr',
};

console.log(`Recette ${recipe.id} (${recipe.kind}), soumission ${submit ? 'activee' : 'desactivee'}.`);
console.log('La fenetre reste ouverte 60 secondes apres le remplissage.');

const result = await runRecipe({
  recipe: submit ? recipe : { ...recipe, form: { ...recipe.form, submit: '' } },
  broker,
  profile,
  requestId: 'essai-local',
  headed: true,
});

console.log('');
console.log('Resultat :', result.outcome);
if (result.message) console.log('Detail   :', result.message);
if (result.finalUrl) console.log('Page     :', result.finalUrl);
if (result.screenshot) console.log('Capture  :', result.screenshot);

process.exit(result.outcome === 'error' ? 1 : 0);
