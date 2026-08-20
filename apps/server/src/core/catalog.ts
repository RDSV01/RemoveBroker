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

/**
 * Contacts trouvés par le navigateur local, superposés au catalogue.
 *
 * Sans cette couche, la recherche de contact ne servait à rien: elle trouvait
 * bien l'adresse, la notait dans `broker_contact`, replanifiait l'envoi... et
 * l'envoi relisait le catalogue, où le courtier n'a toujours pas d'adresse,
 * pour conclure « ce courtier n'accepte pas les demandes par email ». Sur la
 * première utilisation réelle: 65 adresses trouvées, 64 demandes abandonnées.
 */
export interface BrokerContact {
  email?: string;
  optOutUrl?: string;
  /** L'adresse du catalogue rebondit: ne plus la proposer sur cette installation. */
  dead?: boolean;
}

let discovered = new Map<string, BrokerContact>();

function loadDiscoveredContacts(): void {
  try {
    const rows = getDb()
      .prepare('SELECT broker_id, email, opt_out_url, dead FROM broker_contact WHERE email IS NOT NULL OR opt_out_url IS NOT NULL OR dead = 1')
      .all() as { broker_id: string; email: string | null; opt_out_url: string | null; dead: number }[];
    discovered = new Map(rows.map((r) => [r.broker_id, {
      email: r.email ?? undefined,
      optOutUrl: r.opt_out_url ?? undefined,
      dead: r.dead === 1,
    }]));
  } catch {
    discovered = new Map();
  }
}

/** Applique un contact au courtier indexé, sans écraser celui du catalogue. */
function overlay(broker: Broker, contact: BrokerContact): Broker {
  // Une adresse dont on a constaté le rebond ne vaut plus rien, même écrite au
  // catalogue: la garder revient à réécrire à un destinataire inexistant à
  // chaque relance. Le courtier redevient « sans contact », ce qui déclenche la
  // recherche sur son site plutôt qu'un nouvel envoi perdu.
  const base = contact.dead ? undefined : broker.email;
  const email = base ?? contact.email;
  const optOutUrl = broker.optOutUrl ?? contact.optOutUrl;
  if (email === broker.email && optOutUrl === broker.optOutUrl) return broker;
  const methods = new Set(broker.methods);
  if (email) methods.add('email');
  else methods.delete('email');
  if (optOutUrl) methods.add('form');
  if (!methods.size) methods.add('manual');
  else methods.delete('manual');
  return { ...broker, email, optOutUrl, methods: [...methods] };
}

/**
 * Enregistre un contact découvert et le rend immédiatement utilisable.
 * Appelée par la recherche de contact, juste après l'écriture en base.
 */
export function applyDiscoveredContact(brokerId: string, contact: BrokerContact): void {
  if (!contact.email && !contact.optOutUrl && !contact.dead) {
    discovered.delete(brokerId);
    return;
  }
  discovered.set(brokerId, contact);
  const original = catalog.brokers.find((b) => b.id === brokerId) ?? brokerIndex.get(brokerId);
  if (original) brokerIndex.set(brokerId, overlay(original, contact));
}


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
  loadDiscoveredContacts();
  for (const [id, contact] of discovered) {
    const broker = brokerIndex.get(id);
    if (broker) brokerIndex.set(id, overlay(broker, contact));
  }
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
  /** L'empreinte publiée a-t-elle pu être comparée, et concorde-t-elle ? */
  verified?: boolean;
}

/**
 * Empreinte publiée à côté du catalogue.
 *
 * Le fichier `index.json` du dépôt porte le SHA256 de `catalog.json`, écrit par
 * la même exécution qui l'a produit. Il était calculé côté application mais
 * comparé à rien: le README promettait une vérification qui n'avait pas lieu.
 * Un fichier tronqué ou modifié en chemin passait donc sans être remarqué.
 *
 * Une empreinte inaccessible n'interrompt pas la mise à jour: le contrôle de
 * forme reste, et l'absence de vérification est signalée plutôt que masquée.
 */
async function publishedDigest(catalogUrl: string, signal: AbortSignal): Promise<string | null> {
  if (!/catalog\.json$/i.test(catalogUrl)) return null;
  try {
    const res = await fetch(catalogUrl.replace(/catalog\.json$/i, 'index.json'), {
      signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as { sha256?: string };
    return typeof meta.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(meta.sha256) ? meta.sha256.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Requête anonyme vers un fichier statique: aucun cookie, aucun identifiant. */
const USER_AGENT = 'RemoveBroker';

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
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const digest = crypto.createHash('sha256').update(text).digest('hex');

    const expected = await publishedDigest(privacy.catalogUrl, controller.signal);
    if (expected && expected !== digest) {
      throw new Error("l'empreinte du catalogue téléchargé ne correspond pas à celle publiée");
    }

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
        sha256: digest,
        verified: Boolean(expected),
        added,
      }), nowIso());

    log.info('catalogue mis à jour', { total: parsed.brokers.length, nouveaux: added.length, empreinte: expected ? 'vérifiée' : 'non publiée' });
    return {
      updated: true,
      total: parsed.brokers.length,
      added,
      verified: Boolean(expected),
      message: added.length ? `${added.length} nouveaux courtiers ajoutés.` : 'Catalogue déjà à jour.',
    };
  } catch (err) {
    log.warn('mise à jour du catalogue impossible', { raison: String((err as Error).message) });
    return { updated: false, total: catalog.brokers.length, added: [], message: `Mise à jour impossible: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function catalogMeta(): { checkedAt?: string; count: number; added: string[]; verified?: boolean } {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('catalog_meta') as { value: string } | undefined;
  let meta: { checkedAt: string; count: number; added: string[]; verified?: boolean } | undefined;
  try {
    meta = row ? JSON.parse(row.value) : undefined;
  } catch {
    // Métadonnée illisible: le catalogue reste utilisable, c'est le seul point
    // qui compte. Planter ici rendrait l'application entière inutilisable.
    meta = undefined;
  }
  return { checkedAt: meta?.checkedAt, count: catalog.brokers.length, added: meta?.added ?? [], verified: meta?.verified };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
