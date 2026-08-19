import fs from 'node:fs';
import { paths } from '../config/paths.js';

/**
 * Journalisation minimale et locale.
 *
 * Règle de vie privée: aucune donnée personnelle dans les journaux. On y écrit
 * des identifiants de brokers et des codes d'état, jamais un nom, une adresse
 * ou le contenu d'un email. Les valeurs sensibles passent par redact().
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.RB_LOG_LEVEL as Level) ?? 'info'] ?? 20;
const toFile = process.env.RB_LOG_FILE !== '0';

/** Masque une valeur: on garde de quoi diagnostiquer, rien de plus. */
export function redact(value: string | undefined | null): string {
  if (!value) return '-';
  const s = String(value);
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    return `${local.slice(0, 2)}***@${domain ?? '?'}`;
  }
  return s.length <= 4 ? '***' : `${s.slice(0, 2)}***${s.slice(-1)}`;
}

/**
 * Retire les accents pour l'affichage console.
 *
 * La console Windows utilise encore une page de code historique: du texte
 * UTF-8 accentué y apparaît en caractères illisibles. Le fichier journal, lui,
 * conserve le texte accentué.
 */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE');
}

const needsFolding = process.platform === 'win32';

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const suffix = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`;
  const shown = needsFolding ? foldAccents(line) : line;
  if (level === 'error' || level === 'warn') console.error(shown);
  else console.log(shown);
  if (toFile) {
    try {
      fs.appendFileSync(paths.logFile, line + '\n', { mode: 0o600 });
    } catch {
      /* le disque peut être plein ou en lecture seule: ne jamais planter pour un log */
    }
  }
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, e?: Record<string, unknown>) => write('debug', scope, m, e),
    info: (m: string, e?: Record<string, unknown>) => write('info', scope, m, e),
    warn: (m: string, e?: Record<string, unknown>) => write('warn', scope, m, e),
    error: (m: string, e?: Record<string, unknown>) => write('error', scope, m, e),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Vide le journal, propose depuis les paramètrès de confidentialité. */
export function clearLogFile(): void {
  try {
    fs.writeFileSync(paths.logFile, '', { mode: 0o600 });
  } catch {
    /* ignore */
  }
}
