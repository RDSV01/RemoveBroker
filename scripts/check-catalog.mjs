#!/usr/bin/env node
/**
 * Vérifie le catalogue avant publication.
 *
 * Une entrée mal formée n'est pas un détail cosmétique: une adresse invalide
 * fait rebondir un envoi, une URL cassée envoie l'utilisateur nulle part, et un
 * doublon fait écrire deux fois à la même société. Ce script tourne en
 * intégration continue et sur chaque proposition de contribution.
 *
 *   node scripts/check-catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'catalog');

const CATEGORIES = new Set([
  'people-search', 'phone-directory', 'background-check', 'b2b', 'business-search',
  'marketing', 'location', 'credit-risk', 'health', 'other',
]);
const REGIONS = new Set(['us', 'eu', 'fr', 'uk', 'ca', 'au', 'intl']);
const METHODS = new Set(['email', 'form', 'recipe', 'manual']);

const errors = [];
const warnings = [];

const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

// --- catalogue compilé -------------------------------------------------------

const catalogPath = path.join(CATALOG_DIR, 'catalog.json');
if (!fs.existsSync(catalogPath)) {
  console.error('catalog/catalog.json absent. Lancez node scripts/build-catalog.mjs');
  process.exit(1);
}

const catalog = readJson(catalogPath);
const index = readJson(path.join(CATALOG_DIR, 'index.json'));

if (!Array.isArray(catalog.brokers) || catalog.brokers.length === 0) fail('catalog.brokers est vide');
if (!Array.isArray(catalog.recipes)) fail('catalog.recipes manquant');

const recipeIds = new Set((catalog.recipes ?? []).map((r) => r.id));
const seenIds = new Set();
const seenDomains = new Map();

for (const broker of catalog.brokers ?? []) {
  const where = `${broker.name ?? '(sans nom)'} [${broker.id ?? '?'}]`;

  if (!broker.id) fail(`${where}: identifiant manquant`);
  else if (seenIds.has(broker.id)) fail(`${where}: identifiant en double`);
  else seenIds.add(broker.id);

  if (!broker.name || broker.name.length < 2) fail(`${where}: nom manquant ou trop court`);

  if (broker.domain) {
    const previous = seenDomains.get(broker.domain);
    if (previous) fail(`${where}: domaine ${broker.domain} déjà utilisé par ${previous}`);
    else seenDomains.set(broker.domain, broker.id);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(broker.domain)) fail(`${where}: domaine mal formé (${broker.domain})`);
  }

  if (!CATEGORIES.has(broker.category)) fail(`${where}: catégorie inconnue (${broker.category})`);

  if (!Array.isArray(broker.regions) || broker.regions.length === 0) fail(`${where}: aucune région`);
  else for (const region of broker.regions) {
    if (!REGIONS.has(region)) fail(`${where}: région inconnue (${region})`);
  }

  if (broker.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(broker.email)) {
    fail(`${where}: adresse invalide (${broker.email})`);
  }

  for (const field of ['website', 'optOutUrl', 'guideUrl', 'videoUrl']) {
    const value = broker[field];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) fail(`${where}: ${field} n'est pas une URL http (${value})`);
    } catch {
      fail(`${where}: ${field} illisible (${value})`);
    }
  }

  if (!Array.isArray(broker.methods) || broker.methods.length === 0) fail(`${where}: aucune méthode d'opt-out`);
  else for (const method of broker.methods) {
    if (!METHODS.has(method)) fail(`${where}: méthode inconnue (${method})`);
  }

  if (broker.recipe && !recipeIds.has(broker.recipe)) fail(`${where}: recette introuvable (${broker.recipe})`);

  if (typeof broker.score !== 'number' || broker.score < 0 || broker.score > 200) {
    fail(`${where}: score hors bornes (${broker.score})`);
  }

  if (!broker.email && !broker.optOutUrl && !broker.website) {
    warn(`${where}: aucun moyen de contact, l'entrée ne sert à rien`);
  }
}

// --- index publié ------------------------------------------------------------

if (index.count !== catalog.brokers.length) {
  fail(`index.json annonce ${index.count} courtiers, catalog.json en contient ${catalog.brokers.length}`);
}
if (!index.sha256 || index.sha256.length !== 64) fail('index.json: empreinte sha256 absente ou mal formée');

// L'empreinte doit correspondre au fichier réellement publié, sinon les clients
// refuseront la mise à jour.
const { createHash } = await import('node:crypto');
const actual = createHash('sha256').update(fs.readFileSync(catalogPath)).digest('hex');
if (index.sha256 !== actual) fail('index.json: empreinte différente de catalog.json (relancez build-catalog)');

// --- fichiers de contribution ------------------------------------------------

const overridesDir = path.join(CATALOG_DIR, 'overrides');
for (const file of fs.existsSync(overridesDir) ? fs.readdirSync(overridesDir) : []) {
  if (!/\.ya?ml$/.test(file)) continue;
  let parsed;
  try {
    parsed = parseYaml(fs.readFileSync(path.join(overridesDir, file), 'utf8'));
  } catch (err) {
    fail(`overrides/${file}: YAML illisible (${err.message})`);
    continue;
  }
  for (const entry of parsed?.brokers ?? []) {
    if (entry.patch && !entry.domain) fail(`overrides/${file}: un patch doit indiquer le domaine à corriger`);
    if (!entry.patch && !entry.name) fail(`overrides/${file}: une entrée complète doit avoir un nom`);
    if (entry.category && !CATEGORIES.has(entry.category)) fail(`overrides/${file}: catégorie inconnue (${entry.category})`);
    for (const region of entry.regions ?? []) {
      if (!REGIONS.has(region)) fail(`overrides/${file}: région inconnue (${region})`);
    }
  }
}

// --- recettes ----------------------------------------------------------------

const RECIPE_KINDS = new Set(['direct-form', 'search-form']);
const CAPTCHA_KINDS = new Set(['none', 'recaptcha', 'hcaptcha', 'turnstile', 'unknown']);
/** Variables que le moteur sait remplacer dans une recette. */
const PLACEHOLDERS = new Set([
  'fullName', 'firstName', 'lastName', 'email', 'phone', 'city', 'state',
  'stateCode', 'postalCode', 'country', 'addressLine1', 'birthYear',
  'listingUrl', 'reason', 'advertisingId',
]);

for (const recipe of catalog.recipes ?? []) {
  const where = `recette ${recipe.id ?? '(sans identifiant)'}`;
  if (!recipe.id) fail("une recette n'a pas d'identifiant");
  if (!recipe.domain) fail(`${where}: domaine manquant`);
  if (!RECIPE_KINDS.has(recipe.kind)) fail(`${where}: type inconnu (${recipe.kind})`);
  if (recipe.captcha && !CAPTCHA_KINDS.has(recipe.captcha)) fail(`${where}: captcha inconnu (${recipe.captcha})`);

  if (recipe.kind === 'search-form' && !recipe.search?.url) {
    fail(`${where}: une recette de type search-form doit indiquer search.url`);
  }

  if (!recipe.form?.url) fail(`${where}: form.url manquant`);
  if (!Array.isArray(recipe.form?.fields) || recipe.form.fields.length === 0) {
    fail(`${where}: aucun champ à remplir`);
  }
  if (!recipe.form?.submit) fail(`${where}: sélecteur de validation manquant`);

  for (const field of recipe.form?.fields ?? []) {
    if (!field.selector) fail(`${where}: un champ sans sélecteur CSS`);
    if (field.value == null) fail(`${where}: champ ${field.selector} sans valeur`);
  }

  // Une variable mal orthographiée passerait inaperçue jusqu'à l'envoi, où
  // elle remplirait le formulaire avec du texte littéral.
  const text = JSON.stringify(recipe);
  for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!PLACEHOLDERS.has(match[1])) fail(`${where}: variable inconnue {{${match[1]}}}`);
  }

  if (!recipe.form?.success?.text?.length && !recipe.form?.success?.urlContains?.length) {
    warn(`${where}: aucun critère de succès, la soumission sera marquée incertaine`);
  }
}

// --- verdict -----------------------------------------------------------------

for (const message of warnings) console.warn(`  attention  ${message}`);
for (const message of errors) console.error(`  erreur     ${message}`);

console.log('');
console.log(`${catalog.brokers.length} courtiers, ${catalog.recipes?.length ?? 0} recettes verifies.`);
console.log(`${errors.length} erreur(s), ${warnings.length} avertissement(s).`);

process.exit(errors.length ? 1 : 0);
