#!/usr/bin/env node
/**
 *   node scripts/test-ui.mjs [http://127.0.0.1:7777]
 *
 * Clique réellement chaque bouton d'action de l'interface et vérifie qu'aucune
 * requête ne repart en erreur. Une vérification faite en curl ne suffit pas:
 * le navigateur envoie des en-têtes que curl n'envoie pas, et c'est exactement
 * ce qui avait laissé passer le "Bad request" sur les actions sans paramètre.
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:7777';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const failures = [];
page.on('response', async (res) => {
  if (!res.url().includes('/api/')) return;
  if (res.status() < 400) return;
  let body = '';
  try { body = (await res.text()).slice(0, 120); } catch { /* corps illisible */ }
  failures.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE, '')} ${body}`);
});

const click = async (label, route = '/') => {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const target = page.getByRole('button', { name: label }).first();
  if (await target.count() === 0) {
    console.log(`  ${label.padEnd(32)} bouton introuvable`);
    return;
  }
  const before = failures.length;
  await target.click();
  await page.waitForTimeout(2200);
  console.log(`  ${label.padEnd(32)} ${failures.length === before ? 'ok' : 'ECHEC'}`);
};

console.log('Tableau de bord');
await click('Relever les réponses');
await click('Suspendre');
await click('Reprendre');
await click('Vérifier les nouveaux courtiers');

console.log('Paramètres, confidentialité');
await page.goto(BASE + '/parametres', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Confidentialité' }).click();
await page.waitForTimeout(800);
for (const label of ['Effacer les journaux', 'Afficher la clé de secours']) {
  const before = failures.length;
  await page.getByRole('button', { name: label }).first().click();
  await page.waitForTimeout(1500);
  console.log(`  ${label.padEnd(32)} ${failures.length === before ? 'ok' : 'ECHEC'}`);
  await page.keyboard.press('Escape');
}

console.log('Courtiers');
await page.goto(BASE + '/courtiers', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const before = failures.length;
await page.locator('input[type="checkbox"]').first().check();
await page.waitForTimeout(400);
const launch = page.getByRole('button', { name: /Envoyer|Lancer|demande/i }).first();
if (await launch.count()) {
  await launch.click();
  await page.waitForTimeout(2500);
}
console.log(`  ${'campagne sur selection'.padEnd(32)} ${failures.length === before ? 'ok' : 'ECHEC'}`);

console.log('');
console.log(failures.length ? `${failures.length} requete(s) en erreur:` : 'aucune requete en erreur');
for (const f of [...new Set(failures)]) console.log('  ' + f);

await browser.close();
process.exit(failures.length ? 1 : 0);
