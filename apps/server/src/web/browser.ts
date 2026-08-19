import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { paths } from '../config/paths.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('browser');
const require = createRequire(import.meta.url);

/**
 * Accès au navigateur pour l'automatisation des formulaires.
 *
 * Stratégie: réutiliser un navigateur déjà installé sur la machine avant de
 * proposer un téléchargement. Sous Windows, Edge est toujours présent, donc
 * l'automatisation fonctionne sans faire télécharger 300 Mo à l'utilisateur.
 */

export type BrowserSource = { executablePath: string; label: string };

/**
 * Emplacements possibles d'un navigateur déjà installé.
 *
 * Un chemin peut contenir un `*`: Edge et Chrome rangent désormais leur
 * exécutable dans un dossier nommé d'après leur version, qui change à chaque
 * mise à jour. Une liste figée ne les trouverait plus.
 */
function candidatePaths(): { pattern: string; label: string }[] {
  const home = process.env.LOCALAPPDATA ?? '';
  if (process.platform === 'win32') {
    return [
      { pattern: 'C:/Program Files/Google/Chrome/Application/chrome.exe', label: 'Google Chrome' },
      { pattern: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', label: 'Google Chrome' },
      { pattern: `${home}/Google/Chrome/Application/chrome.exe`, label: 'Google Chrome' },
      { pattern: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', label: 'Microsoft Edge' },
      { pattern: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', label: 'Microsoft Edge' },
      { pattern: 'C:/Program Files (x86)/Microsoft/EdgeCore/*/msedge.exe', label: 'Microsoft Edge' },
      { pattern: 'C:/Program Files/Microsoft/EdgeCore/*/msedge.exe', label: 'Microsoft Edge' },
      { pattern: `${home}/Microsoft/EdgeCore/*/msedge.exe`, label: 'Microsoft Edge' },
    ];
  }
  if (process.platform === 'darwin') {
    return [
      { pattern: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Google Chrome' },
      { pattern: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', label: 'Microsoft Edge' },
      { pattern: '/Applications/Chromium.app/Contents/MacOS/Chromium', label: 'Chromium' },
    ];
  }
  return [
    { pattern: '/usr/bin/google-chrome', label: 'Google Chrome' },
    { pattern: '/usr/bin/google-chrome-stable', label: 'Google Chrome' },
    { pattern: '/usr/bin/chromium', label: 'Chromium' },
    { pattern: '/usr/bin/chromium-browser', label: 'Chromium' },
    { pattern: '/usr/bin/microsoft-edge', label: 'Microsoft Edge' },
    { pattern: '/snap/bin/chromium', label: 'Chromium' },
  ];
}

/** Résout un chemin contenant au plus un `*`, en prenant la version la plus récente. */
function resolvePattern(pattern: string): string | null {
  if (!pattern) return null;
  if (!pattern.includes('*')) return fs.existsSync(pattern) ? pattern : null;

  const [prefix, suffix] = pattern.split('*');
  const parent = prefix.replace(/[\\/]$/, '');
  let entries: string[];
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return null;
  }
  const matches = entries
    .map((name) => path.join(parent, name, suffix.replace(/^[\\/]/, '')))
    .filter((full) => fs.existsSync(full))
    .sort()
    .reverse();
  return matches[0] ?? null;
}

/** Chromium téléchargé par playwright dans le dossier de données. */
function findDownloadedChromium(): string | null {
  try {
    for (const dir of fs.readdirSync(paths.browsersDir).filter((d) => d.startsWith('chromium'))) {
      const candidates = [
        path.join(paths.browsersDir, dir, 'chrome-win', 'chrome.exe'),
        path.join(paths.browsersDir, dir, 'chrome-linux', 'chrome'),
        path.join(paths.browsersDir, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) return found;
    }
  } catch {
    /* dossier absent: aucun navigateur téléchargé */
  }
  return null;
}

export function resolveBrowser(): BrowserSource | null {
  for (const { pattern, label } of candidatePaths()) {
    const found = resolvePattern(pattern);
    if (found) return { executablePath: found, label };
  }
  const downloaded = findDownloadedChromium();
  return downloaded ? { executablePath: downloaded, label: 'Chromium téléchargé par RemoveBroker' } : null;
}

export function browserStatus(): { available: boolean; source: string; canInstall: boolean } {
  const source = resolveBrowser();
  return { available: source != null, source: source?.label ?? 'aucun', canInstall: true };
}

/**
 * Télécharge Chromium via l'outil de playwright, dans le dossier de données.
 * Retourne un flux de lignes pour afficher la progression dans l'interface.
 */
export function installBrowser(onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // playwright-core déclare un champ "exports" qui interdit d'atteindre
    // cli.js directement: on résout le point d'entrée puis on remonte au
    // dossier du paquet.
    let cliPath: string;
    try {
      cliPath = path.join(path.dirname(require.resolve('playwright-core')), 'cli.js');
      if (!fs.existsSync(cliPath)) throw new Error('cli.js introuvable');
    } catch {
      reject(new Error("Outil d'installation introuvable dans playwright-core."));
      return;
    }

    fs.mkdirSync(paths.browsersDir, { recursive: true });
    const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: paths.browsersDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onLine(line.trim());
      }
    };
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        log.info('chromium installé');
        resolve();
      } else reject(new Error(`Installation interrompue (code ${code}).`));
    });
  });
}

export interface LaunchOptions {
  /** Mode assisté: fenêtre visible, l'utilisateur termine ce que le script ne peut pas faire. */
  headed?: boolean;
  locale?: string;
}

export async function launchContext(options: LaunchOptions = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  const source = resolveBrowser();
  if (!source) {
    throw new Error("Aucun navigateur disponible. Installez-en un depuis Paramètres, ou installez Google Chrome.");
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH ??= paths.browsersDir;

  const browser = await chromium.launch({
    headless: !options.headed,
    executablePath: source.executablePath,
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check', '--no-first-run'],
  });

  const context = await browser.newContext({
    locale: options.locale ?? 'en-US',
    viewport: { width: 1280, height: 900 },
    // Un navigateur trop identifiable est bloqué par les protections anti-bot
    // des courtiers, ce qui fait échouer des demandes parfaitement légitimes.
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(30_000);

  // Neutralise le drapeau webdriver, principal signal utilise pour refuser
  // l'accès aux formulaires d'opt-out.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser, context };
}
