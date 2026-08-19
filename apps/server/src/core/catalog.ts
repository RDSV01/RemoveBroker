import crypto from 'node:crypto';
import fs from 'node:fs';
import { paths } from '../config/paths.js';
import { getDb, nowIso } from '../db/index.js';
import { getSetting } from './settings.js';
import { createLogger } from '../util/logger.js';
import type { Broker, Catalog, Recipe } from '../types.js';

const log = createLogger('catalog');

/**
 * Catalogue des courtiers en données.
 *
 * Trois couches, de la moins à la plus prioritaire:
 *   1. le catalogue livré avec l'application (fonctionne hors ligne),
 *   2. le catalogue télécharge depuis le dépôt public (mises à jour),
 *   3. les brokers ajoutés à la main par l'utilisateur.
 *
 * Le point important: la mise à jour ne coûte rien a héberger. Le dépôt GitHub
 * régénère catalog.json chaque semaine et l'application le télécharge en une
 * requête anonyme. Aucun serveur applicatif, aucun identifiant transmis.
 */

let catalog: Catalog = { brokers: [], recipes: [] };
let recipeIndex = new Map<string, Recipe>();
let brokerIndex = new Map<string, Broker>();

export function loadCatalog(): Catalog {
  const candidates = [paths.catalogCache, paths.catalogBundled];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog;
      if (Array.isArray(parsed.brokers) && parsed.brokers.length) {
        catalog = parsed;
        log.info('catalogue charge', { source: file === paths.catalogCache ? 'cache' : 'livre', brokers: parsed.brokers.length });
        break;
      }
    } catch {
      /* on essaie le candidat suivant */
    }
  }
  reindex();
  return catalog;
}

function reindex(): void {
  recipeIndex = new Map(catalog.recipes.map((r) => [r.id, r]));
  brokerIndex = new Map(catalog.brokers.map((b) => [b.id, b]));
  for (const custom of listCustomBrokers()) brokerIndex.set(custom.id, custom);
}

export function getRecipe(id: string | undefined): Recipe | undefined {
  return id ? recipeIndex.get(id) : undefined;
}

export function getBroker(id: string): Broker | undefined {
  return brokerIndex.get(id);
}

export function allBrokers(): Broker[] {
  return [...brokerIndex.values()];
}

export function catalogStats() {
  const brokers = allBrokers();
  const byCategory: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const b of brokers) {
    byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
    for (const r of b.regions) byRegion[r] = (byRegion[r] ?? 0) + 1;
  }
  // Une entrée sans adresse ni formulaire ne peut produire aucune demande tant
  // qu'un contact n'a pas été trouvé. La compter comme « couverte » gonflerait
  // le catalogue d'un chiffre que l'utilisateur ne peut pas utiliser.
  const reachable = brokers.filter((b) => b.email || b.optOutUrl);
  return {
    total: brokers.length,
    reachable: reachable.length,
    needsDiscovery: brokers.length - reachable.length,
    withEmail: brokers.filter((b) => b.email).length,
    withRecipe: brokers.filter((b) => b.recipe).length,
    withForm: brokers.filter((b) => b.optOutUrl).length,
    france: brokers.filter((b) => b.france).length,
    franceReachable: reachable.filter((b) => b.france).length,
    byCategory,
    byRegion,
  };
}

// ---------------------------------------------------------------------------
// Brokers personnalisés
// ---------------------------------------------------------------------------

export function listCustomBrokers(): Broker[] {
  try {
    const rows = getDb().prepare('SELECT data FROM custom_broker').all() as { data: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.data) as Broker), custom: true }));
  } catch {
    return [];
  }
}

export function upsertCustomBroker(input: Partial<Broker> & { name: string }): Broker {
  const id = input.id ?? `custom-${slug(input.name)}`;
  const broker: Broker = {
    id,
    name: input.name,
    domain: input.domain,
    website: input.website,
    category: input.category ?? 'other',
    regions: input.regions?.length ? input.regions : ['eu'],
    email: input.email,
    optOutUrl: input.optOutUrl,
    notes: input.notes,
    sources: ['manual'],
    firstSeen: nowIso().slice(0, 10),
    methods: input.email ? ['email'] : input.optOutUrl ? ['form'] : ['manual'],
    score: 60,
    custom: true,
  };
  getDb()
    .prepare('INSERT INTO custom_broker (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(broker));
  brokerIndex.set(id, broker);
  return broker;
}

export function deleteCustomBroker(id: string): void {
  getDb().prepare('DELETE FROM custom_broker WHERE id = ?').run(id);
  brokerIndex.delete(id);
}

// ---------------------------------------------------------------------------
// Mise à jour depuis le dépôt public
// ---------------------------------------------------------------------------

export interface UpdateResult {
  updated: boolean;
  total: number;
  added: string[];
  message: string;
}

/**
 * Télécharge le catalogue publié et ne le remplace que s'il est validé et plus
 * fourni. Une source corrompue ou tronquée ne doit jamais effacer un catalogue
 * qui fonctionne.
 */
export async function updateCatalog(force = false): Promise<UpdateResult> {
  const privacy = getSetting('privacy');
  if (!privacy.catalogAutoUpdate && !force) {
    return { updated: false, total: catalog.brokers.length, added: [], message: 'Mise à jour automatique désactivée.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(privacy.catalogUrl, {
      signal: controller.signal,
      // Aucun cookie, aucun identifiant: une requête anonyme vers un fichier statique.
      headers: { accept: 'application/json', 'user-agent': 'RemoveBroker/0.1' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = JSON.parse(text) as Catalog;

    if (!Array.isArray(parsed.brokers) || parsed.brokers.length < 100) {
      throw new Error('catalogue distant invalide ou trop court');
    }

    const before = new Set(catalog.brokers.map((b) => b.id));
    const added = parsed.brokers.filter((b) => !before.has(b.id)).map((b) => b.id);

    fs.writeFileSync(paths.catalogCache, text, { mode: 0o600 });
    catalog = parsed;
    reindex();

    // Métadonnée technique, non sensible: stockee en clair pour rester lisible
    // même si le coffre est verrouillé.
    getDb()
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run('catalog_meta', JSON.stringify({
        checkedAt: nowIso(),
        count: parsed.brokers.length,
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
        added,
      }), nowIso());

    log.info('catalogue mis à jour', { total: parsed.brokers.length, nouveaux: added.length });
    return {
      updated: true,
      total: parsed.brokers.length,
      added,
      message: added.length ? `${added.length} nouveaux courtiers ajoutés.` : 'Catalogue déjà à jour.',
    };
  } catch (err) {
    log.warn('mise à jour du catalogue impossible', { raison: String((err as Error).message) });
    return { updated: false, total: catalog.brokers.length, added: [], message: `Mise à jour impossible: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function catalogMeta(): { checkedAt?: string; count: number; added: string[] } {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('catalog_meta') as { value: string } | undefined;
  const meta = row ? (JSON.parse(row.value) as { checkedAt: string; count: number; added: string[] }) : undefined;
  return { checkedAt: meta?.checkedAt, count: catalog.brokers.length, added: meta?.added ?? [] };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
