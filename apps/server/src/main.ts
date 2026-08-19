import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, paths } from './config/paths.js';
import { openDatabase } from './db/index.js';
import { keyringStatus, unlock } from './crypto/keyring.js';
import { loadCatalog } from './core/catalog.js';
import { getSetting } from './core/settings.js';
import { startEngine, stopEngine } from './engine/lifecycle.js';
import { registerApi } from './routes/api.js';
import { createLogger, foldAccents } from './util/logger.js';

const log = createLogger('main');

/**
 * Réexporté pour l'enveloppe de bureau: elle appelle registerOsSealer avant
 * startServer pour brancher le trousseau du système sur le chiffrement local.
 */
export { registerOsSealer } from './crypto/keyring.js';
export type { OsSealer } from './crypto/keyring.js';

/** Fourni par l'enveloppe de bureau: seul le systeme sait inscrire au demarrage. */
export { registerAutoStart } from './core/autostart.js';
export type { AutoStart } from './core/autostart.js';

/**
 * Point d'entree. La même fonction sert au démarrage en ligne de commande, en
 * conteneur et depuis l'application de bureau: une seule façon de démarrer,
 * donc un seul comportement à maintenir.
 */

export interface ServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(options: { port?: number; host?: string } = {}): Promise<ServerHandle> {
  ensureDirs();
  openDatabase();

  // En mode "phrase secrète", unlock() renvoie false: le serveur démarre quand
  // même pour que l'interface puisse demander la phrase.
  let unlocked = false;
  try {
    unlocked = unlock(process.env.RB_PASSPHRASE);
  } catch (err) {
    log.warn('coffre verrouillé', { raison: String((err as Error).message) });
  }

  loadCatalog();

  const port = Number(options.port ?? process.env.RB_PORT ?? 7777);
  const host = options.host ?? process.env.RB_HOST ?? '127.0.0.1';
  // Renseigné une fois l'écoute établie: le port demandé peut être occupé.
  let boundPort = port;

  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    // L'application est locale: aucune requête distante n'a de raison
    // d'atteindre cette API.
    trustProxy: false,
  });

  // Refus des requêtes provenant d'une autre origine: protégé l'API locale
  // contre une page web ouverte dans le même navigateur.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, 'http://localhost:5173', 'http://127.0.0.1:5173'];
    if (!allowed.includes(origin)) {
      return reply.code(403).send({ error: 'Origine non autorisée.' });
    }
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  });

  app.options('/api/*', async (_req, reply) => reply.code(204).send());

  registerApi(app);

  // Interface compilée. En développement, Vite sert l'interface sur son propre
  // port et parle à cette API.
  if (fs.existsSync(paths.webDist)) {
    await app.register(fastifyStatic, { root: paths.webDist, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Route inconnue.' });
      return reply.type('text/html').send(fs.readFileSync(path.join(paths.webDist, 'index.html')));
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html').send(
      "<!doctype html><meta charset=utf-8><title>RemoveBroker</title><body style=\"font-family:system-ui;padding:3rem;max-width:40rem\"><h1>RemoveBroker</h1><p>L'interface n'est pas compilée. Lancez <code>npm run build</code>, ou <code>npm run dev</code> pour le mode développement.</p></body>",
    ));
  }

  // Le port par défaut peut être pris par un autre logiciel. Plutôt que
  // d'échouer avec une erreur incompréhensible, on essaie les suivants.
  for (let attempt = 0; ; attempt++) {
    try {
      await app.listen({ port: boundPort, host });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= 12) throw err;
      boundPort = port + attempt + 1;
      log.warn('port occupé, tentative suivante', { essaye: boundPort - 1, suivant: boundPort });
    }
  }

  if (unlocked) startEngine();

  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}`;
  log.info('serveur pret', { url, coffre: unlocked ? 'ouvert' : 'verrouille' });

  return {
    url,
    port: boundPort,
    async close() {
      stopEngine();
      await app.close();
    },
  };
}

/** Démarrage direct: node dist/main.js */
// Sous Electron, ce fichier est importé par l'enveloppe de bureau qui appelle
// startServer elle-même: il ne doit surtout pas démarrer un second serveur.
const isDirectRun = !process.versions.electron
  && process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) {
  startServer()
    .then((handle) => {
      const say = (line: string) => console.log(process.platform === 'win32' ? foldAccents(line) : line);
      say('');
      say('  RemoveBroker est prêt.');
      say(`  Ouvrez ${handle.url} dans votre navigateur.`);
      say('');
      const shutdown = () => { void handle.close().then(() => process.exit(0)); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Demarrage impossible:', err);
      process.exit(1);
    });
}
