import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Emplacements sur disque.
 *
 * Toutes les données restent dans un seul dossier, jamais dans le dépôt: on
 * peut sauvegarder ou supprimer la totalité de ses données en supprimant ce
 * dossier, ce qui est le comportement attendu d'un outil de vie privée.
 */

const APP_DIR_NAME = 'RemoveBroker';

function defaultDataDir(): string {
  const env = process.env.RB_DATA_DIR;
  if (env) return path.resolve(env);

  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, APP_DIR_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'removebroker');
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt, en développement (src/) comme après compilation (dist/). */
function findRepoRoot(): string {
  let dir = here;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'catalog', 'sources.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(here, '../../../..');
}

export const REPO_ROOT = findRepoRoot();
export const DATA_DIR = defaultDataDir();

export const paths = {
  dataDir: DATA_DIR,
  database: path.join(DATA_DIR, 'removebroker.db'),
  keyFile: path.join(DATA_DIR, 'master.key'),
  /** Preuves: copies des emails, captures d'écran des formulaires soumis. */
  evidenceDir: path.join(DATA_DIR, 'evidence'),
  logFile: path.join(DATA_DIR, 'removebroker.log'),
  /** Catalogue télécharge, prioritaire sur celui livré avec l'application. */
  catalogCache: path.join(DATA_DIR, 'catalog.json'),
  /** Catalogue livré avec l'application, utilisable hors ligne dès le premier lancement. */
  catalogBundled: path.join(REPO_ROOT, 'catalog', 'catalog.json'),
  browsersDir: path.join(DATA_DIR, 'browsers'),
  /** Interface web compilée. */
  webDist: path.join(REPO_ROOT, 'apps', 'web', 'dist'),
};

export function ensureDirs(): void {
  for (const dir of [paths.dataDir, paths.evidenceDir, paths.browsersDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
