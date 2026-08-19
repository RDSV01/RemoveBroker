#!/usr/bin/env node
/**
 * Télécharge le navigateur qui sert à remplir les formulaires d'opt-out.
 *
 * Il n'est pas inclus dans l'installation: 300 Mo pour une fonctionnalité qui
 * ne concerne qu'une minorité de courtiers, la plupart acceptant une demande
 * par email. On ne le télécharge donc que si quelqu'un le demande, ici en
 * ligne de commande ou depuis Paramètres, Automatisation.
 *
 *   npm run browsers:install
 *
 * Le navigateur est rangé dans le dossier de données de l'application, pas dans
 * le cache global de Playwright: désinstaller RemoveBroker doit tout emporter.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Même emplacement que celui utilisé par le serveur, voir config/paths.ts. */
function dataDir() {
  if (process.env.RB_DATA_DIR) return path.resolve(process.env.RB_DATA_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'RemoveBroker');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'RemoveBroker');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'removebroker');
}

const browsersDir = path.join(dataDir(), 'browsers');

// playwright-core déclare un champ "exports" qui interdit d'atteindre cli.js
// par son chemin: on résout le point d'entrée du paquet, puis on remonte au
// dossier qui le contient.
let cliPath;
try {
  cliPath = path.join(path.dirname(require.resolve('playwright-core')), 'cli.js');
  if (!fs.existsSync(cliPath)) throw new Error('cli.js introuvable');
} catch {
  console.error("playwright-core est absent ou incomplet. Lancez d'abord npm install.");
  process.exit(1);
}

fs.mkdirSync(browsersDir, { recursive: true });

console.log('Telechargement de Chromium dans:');
console.log(`  ${browsersDir}`);
console.log('Environ 300 Mo, quelques minutes selon la connexion.');
console.log('');

const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('Echec du telechargement:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('');
    console.log('Navigateur installe. L automatisation des formulaires est disponible.');
  } else {
    console.error(`Le telechargement s est arrete avec le code ${code}.`);
  }
  process.exit(code ?? 1);
});
