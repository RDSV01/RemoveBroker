#!/usr/bin/env node
/**
 * Vérifié l'environnement après installation et affiche la marche à suivre.
 * Aucune donnée n'est envoyée: ce script ne fait que lire l'état local.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// npm exécute postinstall aussi dans les installations en dependance; on ne
// veut ce message qu'à la racine du dépôt.
if (process.env.CI || !fs.existsSync(path.join(ROOT, 'catalog', 'sources.json'))) process.exit(0);

const catalogPath = path.join(ROOT, 'catalog', 'catalog.json');
const hasCatalog = fs.existsSync(catalogPath);
let count = 0;
if (hasCatalog) {
  try {
    count = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).brokers.length;
  } catch { /* catalogue illisible: le serveur le reconstruira */ }
}

const [major] = process.versions.node.split('.').map(Number);
const lines = [
  '',
  '  RemoveBroker installe.',
  '',
  `  Node          ${process.versions.node}${major < 20 ? '  (Node 20+ requis)' : ''}`,
  `  Catalogue     ${hasCatalog ? `${count} courtiers en donnees` : 'absent, lancez npm run catalog:build'}`,
  '',
  '  Demarrer       npm run build && npm start',
  '  Developpement  npm run dev',
  '  Interface      http://127.0.0.1:7777',
  '',
];
console.log(lines.join('\n'));
