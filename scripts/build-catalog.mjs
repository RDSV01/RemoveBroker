#!/usr/bin/env node
/**
 * Construit catalog/catalog.json à partir des sources declarees dans
 * catalog/sources.json, des surcharges humaines (catalog/overrides) et des
 * recettes d'automatisation (catalog/recipes).
 *
 * Ce script est le coeur du "catalogue vivant": il tourne en CI chaque semaine
 * (.github/workflows/catalogue.yml), commit le résultat, et les applications
 * installees telechargent ce JSON. Aucun serveur a payer.
 *
 * Utilisation:
 *   node scripts/build-catalog.mjs                  # télécharge les sources
 *   node scripts/build-catalog.mjs --from-clones .. # lit des depots clones localement
 *   node scripts/build-catalog.mjs --offline        # n'utilise que les fichiers locaux
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { extractTarGz } from './lib/untar.mjs';

import {
  cleanCompanyName,
  domainFromEmail,
  hostFromUrl,
  isUsableEmail,
  normalizeCategory,
  registrableDomain,
  slugify,
} from './lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'catalog');

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const CLONES_DIR = (() => {
  const i = args.indexOf('--from-clones');
  return i >= 0 && args[i + 1] ? path.resolve(ROOT, args[i + 1]) : null;
})();

// ---------------------------------------------------------------------------
// Lecture des sources
// ---------------------------------------------------------------------------

/** Télécharge une source, ou lit son equivalent dans les depots clones. */
async function readSource(source) {
  if (CLONES_DIR) {
    const localPaths = {
      cppa: null, // pas de copie locale: registre officiel uniquement en ligne
      optery: path.join(CLONES_DIR, 'optery-data-brokers-directory/data/data-brokers.json'),
      eraser: path.join(CLONES_DIR, 'eraser/data/brokers.yaml'),
    };
    const p = localPaths[source.id];
    if (p) {
      try {
        const text = await fs.readFile(p, 'utf8');
        console.log(`  lu localement: ${path.relative(ROOT, p)}`);
        return text;
      } catch {
        /* on retombe sur le téléchargement */
      }
    }
  }
  if (OFFLINE) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'RemoveBroker-catalog-builder/1.0 (+https://github.com/RDSV01/RemoveBroker)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Une archive n'est pas du texte: la decoder en UTF-8 la corromprait.
    return source.binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Parseur CSV conforme RFC 4180 (guillemets et retours ligne echappes inclus). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);

  const header = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ---------------------------------------------------------------------------
// Adaptateurs: chaque source produit des enregistrements au format interne
// ---------------------------------------------------------------------------

/** Registre officiel californien: raison sociale, site, email, URL des droits. */
function adaptCppa(text) {
  const rows = parseCsv(text);
  const col = (row, needle) => {
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(needle));
    return key ? row[key] : '';
  };
  return rows
    .map((row) => {
      const legalName = col(row, 'data broker name');
      const dba = col(row, 'doing business as');
      const website = col(row, 'primary website:');
      const email = col(row, 'primary contact email');
      const rightsUrl = col(row, 'consumers can exercise');
      const country = col(row, 'country');
      const minors = /yes/i.test(col(row, 'personal information of minors'));
      const geo = /yes/i.test(col(row, 'precise geolocation'));
      const reproductive = /yes/i.test(col(row, 'reproductive health'));
      // Le registre autorise plusieurs marques dans la colonne "doing business
      // as": "InfoTracer; GoodCar; RecordsFinder". La premiere devient le nom
      // affiche, les autres restent cherchables.
      const tradeNames = (dba || legalName)
        .split(/\s*;\s*/)
        .map((part) => cleanCompanyName(part))
        .filter(Boolean);
      const name = tradeNames[0];
      if (!name) return null;
      return {
        source: 'cppa',
        name,
        aliases: tradeNames.slice(1),
        legalName: legalName || undefined,
        website,
        email,
        optOutUrl: rightsUrl,
        country: country || 'United States',
        regions: ['us'],
        registeredCA: true,
        sensitive: [minors && 'minors', geo && 'geolocation', reproductive && 'reproductive-health'].filter(Boolean),
      };
    })
    .filter(Boolean);
}

/** Annuaire Optery: marques, catégories, guides pas à pas. */
function adaptOptery(text) {
  const list = JSON.parse(text);
  return list.map((b) => ({
    source: 'optery',
    name: cleanCompanyName(b.title),
    website: b.website,
    email: b.email,
    optOutUrl: b.opt_out_url,
    guideUrl: b.opt_out_guide_url || undefined,
    videoUrl: b.opt_out_guide_video_url || undefined,
    category: normalizeCategory(b.type),
    description: b.description || undefined,
    reach: b.is_expanded_reach ? 'expanded' : undefined,
    regions: ['us'],
  }));
}

/** Liste eraser: large couverture marketing, toujours avec une adresse email. */
function adaptEraser(text) {
  const doc = YAML.parse(text);
  const list = doc?.brokers ?? [];
  return list.map((b) => ({
    source: 'eraser',
    name: cleanCompanyName(b.name),
    website: b.website,
    email: b.email,
    optOutUrl: b.opt_out_url,
    category: normalizeCategory(b.category),
    regions: b.region === 'global' ? ['us', 'eu'] : [b.region || 'us'],
  }));
}

/**
 * Base Datenanfragen: contacts vie privée d'entreprises soumises au RGPD.
 *
 * Tenue par une association allemande, versee au domaine public (CC0), et
 * surtout verifiee a la main: c'est la seule source qui donne l'adresse du
 * delegue a la protection des donnees d'une societe europeenne, la ou les
 * registres americains n'en savent rien.
 *
 * Deux usages, volontairement distincts:
 *   - completer les courtiers deja connus, quelle que soit leur categorie: si
 *     l'entree existe chez nous, son contact nous interesse;
 *   - n'ajouter de nouvelles societes que si leur categorie en fait un courtier.
 *     Sans ce filtre, on importerait des eglises, des ecoles et des agences de
 *     voyage, qui ne revendent rien.
 */
const CATEGORIES_COURTIER = new Set(['ads', 'addresses', 'credit agency', 'tracking', 'data']);

/** Pays de l'Espace economique europeen, ou le RGPD s'applique directement. */
const PAYS_EEE = new Set([
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu',
  'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es',
  'se', 'is', 'li', 'no', 'ch',
]);

/**
 * Traduit les codes pays de la source vers le vocabulaire de zones du projet.
 *
 * Le catalogue n'emploie qu'une poignee de zones, parce que l'interface les
 * affiche et qu'une liste de trente pays y serait illisible. La granularite
 * fine ne sert qu'a la France, seul pays ou une distinction change l'ordre des
 * demandes.
 */
function regionsDepuisPays(pays) {
  const codes = (pays ?? []).map((p) => String(p).toLowerCase());
  if (!codes.length || codes.includes('all')) return ['eu', 'intl'];

  const zones = new Set();
  for (const code of codes) {
    if (code === 'fr') { zones.add('eu'); zones.add('fr'); }
    else if (code === 'gb' || code === 'uk') zones.add('uk');
    else if (code === 'us') zones.add('us');
    else if (code === 'ca') zones.add('ca');
    else if (code === 'au') zones.add('au');
    else if (PAYS_EEE.has(code)) zones.add('eu');
    else zones.add('intl');
  }
  return [...zones];
}

function adaptDatenanfragen(buffer) {
  const fiches = extractTarGz(buffer, (nom) => /\/companies\/[^/]+\.json$/.test(nom));
  const out = [];

  for (const [, contenu] of fiches) {
    let f;
    try {
      f = JSON.parse(contenu.toString('utf8'));
    } catch {
      continue;
    }
    if (!f?.name || !isUsableEmail(f.email)) continue;
    // La base distingue les fiches verifiees a la main de celles collectees par
    // robot. Une adresse fausse rebondit des semaines plus tard et laisse
    // croire a une demande partie: on ne retient que le verifie.
    if (f.quality !== 'verified') continue;

    const categories = f.categories ?? [];
    const estCourtier = categories.some((c) => CATEGORIES_COURTIER.has(c));
    const pays = f['relevant-countries'] ?? [];

    out.push({
      source: 'datenanfragen',
      name: cleanCompanyName(f.name),
      website: f.web,
      email: f.email,
      // Les societes de cette base relevent du RGPD par construction.
      regions: regionsDepuisPays(pays),
      category: categories.includes('credit agency') ? 'credit-risk'
        : categories.includes('addresses') ? 'marketing'
          : categories.includes('ads') ? 'marketing' : undefined,
      // Marque les entrees qui ne doivent pas creer de nouveau courtier a elles
      // seules: elles servent alors uniquement a completer une fiche existante.
      enrichOnly: !estCourtier,
    });
  }

  return out;
}

/**
 * Liste des fournisseurs du cadre de consentement europeen (TCF).
 *
 * Publiee par IAB Europe, mise a jour chaque semaine, elle recense les
 * societes qui traitent les donnees des internautes europeens a des fins
 * publicitaires. C'est, par construction, la liste la plus proche de ce que
 * cherche ce projet: aucune autre source ne dit aussi precisement qui exploite
 * les donnees d'une personne en Europe.
 *
 * On n'en retient que le nom de la societe et l'adresse de sa propre politique
 * de confidentialite, que chaque fournisseur publie lui-meme. Le contact est
 * ensuite trouve par l'enrichissement, comme pour les autres sources.
 */
function adaptTcf(text) {
  const liste = JSON.parse(text);
  const out = [];

  for (const v of Object.values(liste.vendors ?? {})) {
    if (!v?.name) continue;

    const urls = v.urls ?? [];
    // La page francaise quand elle existe: c'est celle que l'utilisateur lira,
    // et sa presence indique que le fournisseur s'adresse au marche francais.
    const fr = urls.find((u) => u.langId === 'fr')?.privacy;
    const en = urls.find((u) => u.langId === 'en')?.privacy;
    const privacyUrl = fr || en || urls[0]?.privacy;
    if (!privacyUrl) continue;

    let website;
    try {
      website = new URL(privacyUrl).origin;
    } catch {
      continue;
    }

    out.push({
      source: 'tcf',
      name: cleanCompanyName(v.name),
      website,
      privacyUrl,
      // Le TCF est le cadre europeen: y figurer, c'est declarer traiter des
      // donnees de personnes en Europe.
      regions: fr ? ['eu', 'fr'] : ['eu'],
      category: 'marketing',
    });
  }

  return out;
}

const ADAPTERS = {
  'cppa-csv': adaptCppa,
  'optery-json': adaptOptery,
  'eraser-yaml': adaptEraser,
  'datenanfragen-tar': adaptDatenanfragen,
  'tcf-json': adaptTcf,
};

// ---------------------------------------------------------------------------
// Fichiers locaux du dépôt
// ---------------------------------------------------------------------------

async function readYamlDir(dir) {
  const abs = path.join(ROOT, dir);
  let files = [];
  try {
    files = (await fs.readdir(abs)).filter((f) => /\.ya?ml$/i.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(abs, f), 'utf8');
    let doc;
    try {
      doc = YAML.parse(raw);
    } catch (err) {
      throw new Error(`YAML invalide dans ${dir}/${f}: ${err.message}`);
    }
    if (!doc) continue;
    out.push({ file: f, doc });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

/** Clé de fusion: domaine du site, sinon domaine de l'email, sinon le nom. */
function mergeKey(rec) {
  const d = registrableDomain(rec.website || '') || domainFromEmail(rec.email || '');
  return d || `name:${slugify(rec.name)}`;
}

/** Qualite relative des URL d'opt-out selon la source qui les fournit. */
const URL_SOURCE_RANK = { none: 0, cppa: 1, eraser: 2, optery: 3, manual: 4 };

/**
 * Grands acteurs presents des deux cotes de l'Atlantique.
 *
 * Un resident europeen a tout interet a leur ecrire: ils traitent des donnees
 * de personnes en Europe, donc le RGPD s'applique et le delai d'un mois est
 * opposable, meme si leur siege est aux Etats-Unis.
 */
const GLOBAL_PLAYERS = new Set([
  'acxiom.com', 'liveramp.com', 'oracle.com', 'epsilon.com', 'experian.com',
  'equifax.com', 'transunion.com', 'dnb.com', 'nielsen.com', 'data-axle.com',
  'zoominfo.com', 'apollo.io', 'lusha.com', 'rocketreach.co', 'cognism.com',
  'hunter.io', 'snov.io', 'seamless.ai', 'clearbit.com', 'lead411.com',
  'uplead.com', 'signalhire.com', 'contactout.com', 'skrapp.io', 'adapt.io',
  'peopledatalabs.com', 'fullcontact.com', 'pipl.com', 'intelius.com',
  'thomsonreuters.com', 'lexisnexis.com', 'criteo.com', 'thetradedesk.com',
  'quantcast.com', 'lotame.com', 'neustar.com', 'merkle.com', 'infogroup.com',
  'adsquare.com', 'onaudience.com', 'gravy.com', 'kochava.com', 'nearme.com',
]);

/**
 * Un courtier concerne-t-il un resident europeen ?
 *
 * Les sites americains de recherche de personnes indexent des dossiers publics
 * americains: ecrire aux 400 exemplaires depuis la France produit surtout des
 * reponses "aucune donnee". A l'inverse, le marketing, la prospection B2B et
 * le scoring de solvabilite sont des activites transfrontalieres, et le RGPD
 * s'applique des lors que la personne visee reside dans l'Union.
 */
function isEuRelevant(entry) {
  if (entry.regions?.some((r) => r === 'eu' || r === 'fr' || r === 'uk')) return true;
  if (GLOBAL_PLAYERS.has(entry.domain ?? '')) return true;
  return ['marketing', 'location', 'b2b', 'credit-risk', 'health', 'business-search'].includes(entry.category);
}

/**
 * Categories dont l'activite consiste a indexer des dossiers publics
 * americains: casiers judiciaires, registres electoraux, actes de propriete.
 *
 * Ces sites ne detiennent rien sur une personne qui n'a jamais vecu aux
 * Etats-Unis. Les inscrire au catalogue d'un outil destine a la France
 * produirait des centaines de reponses "aucune donnee vous concernant", et
 * noierait les demandes qui, elles, aboutissent.
 */
const CATEGORIES_DOSSIERS_US = ['people-search', 'background-check', 'business-search', 'phone-directory'];

/**
 * L'entree a-t-elle sa place dans un catalogue destine a la France et a
 * l'Europe ?
 *
 * Le critere n'est pas le siege social mais la donnee: une societe americaine
 * qui exploite les donnees de personnes en Europe releve du RGPD et doit
 * repondre. Acxiom, LiveRamp ou Kochava detiennent des donnees francaises;
 * un annuaire de casiers judiciaires du Texas, non.
 */
let verdictsRgpd = {};

function concerneEurope(entry) {
  const zones = entry.regions ?? [];
  const europeen = zones.includes('fr') || zones.includes('eu') || zones.includes('uk');
  if (europeen) return true;

  // Acteur mondial: le RGPD s'applique des lors qu'il cible des personnes en
  // Europe, ce que sa presence dans les listes publicitaires europeennes
  // etablit.
  if (GLOBAL_PLAYERS.has(entry.domain ?? '')) return true;
  if (entry.sources?.includes('tcf')) return true;

  // La localisation ne connait pas de frontiere: ces societes achetent des
  // traces a des applications du monde entier, rattachees a un identifiant
  // publicitaire qui ne dit rien du pays. Elles restent, quoi que dise leur
  // politique.
  if (entry.category === 'location') return true;

  // Verdict tire de la politique de confidentialite de la societe elle-meme
  // (scripts/detect-rgpd.mjs). Une societe qui consacre une section au RGPD
  // ou aux clauses contractuelles types reconnait traiter des donnees
  // europeennes. Une politique qui n'evoque que la Californie ne concerne pas
  // quelqu'un qui n'a jamais vecu aux Etats-Unis.
  //
  // Seul un verdict etabli tranche: faute de politique lisible, l'entree
  // reste, parce qu'une absence de preuve n'est pas une preuve d'absence.
  const verdict = verdictsRgpd[entry.domain ?? '']?.europe;
  if (verdict === true) return true;
  if (verdict === false) return false;

  // Le reste n'est retenu que si son activite est transfrontaliere par nature.
  return !CATEGORIES_DOSSIERS_US.includes(entry.category)
    && ['marketing', 'location', 'credit-risk', 'health', 'b2b'].includes(entry.category);
}

/** Prefere une adresse dédiée vie privée à une adresse générique. */
function betterEmail(current, candidate) {
  if (!isUsableEmail(candidate)) return current;
  if (!current) return candidate;
  const score = (e) => {
    const local = e.split('@')[0].toLowerCase();
    if (/privacy|dsar|gdpr|ccpa|dataprotection|dpo|optout|opt-out|removal|donotsell/.test(local)) return 3;
    if (/legal|compliance|support|help/.test(local)) return 2;
    if (/info|contact|hello|admin/.test(local)) return 1;
    return 0;
  };
  return score(candidate) > score(current) ? candidate : current;
}

/** Priorite d'exposition: qui expose le plus de données personnelles publiques. */
function riskScore(entry) {
  const byCategory = {
    'people-search': 100,
    'phone-directory': 88,
    'background-check': 85,
    'credit-risk': 78,
    health: 76,
    // La localisation revele les deplacements, donc le domicile, le lieu de
    // travail, le medecin et le lieu de culte. Elle passe devant le marketing
    // classique et juste derriere les fiches publiques nominatives.
    location: 82,
    marketing: 55,
    b2b: 40,
    'business-search': 30,
    other: 45,
  };
  let s = byCategory[entry.category] ?? 45;
  if (entry.sensitive?.length) s += entry.sensitive.length * 4;
  if (entry.reach === 'expanded') s += 6;
  if (entry.recipe) s += 8; // automatisable de bout en bout: fort retour sur effort
  if (entry.registeredCA) s += 5; // obligation legale de repondre
  return Math.min(120, s);
}

function methodsFor(entry) {
  const m = [];
  if (entry.recipe) m.push('recipe');
  if (isUsableEmail(entry.email)) m.push('email');
  if (entry.optOutUrl) m.push('form');
  if (!m.length) m.push('manual');
  return m;
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(CATALOG_DIR, 'sources.json'), 'utf8'));
  const collected = [];
  const sourceStats = [];
  const failedSources = [];

  for (const source of cfg.sources) {
    if (!source.enabled) continue;
    process.stdout.write(`Source ${source.id} ... `);
    try {
      const text = await readSource(source);
      if (text == null) { console.log('ignorée (mode hors ligne)'); continue; }
      const records = ADAPTERS[source.format](text);
      collected.push(...records);
      sourceStats.push({ id: source.id, label: source.label, count: records.length });
      console.log(`${records.length} entrées`);
    } catch (err) {
      console.log(`échec: ${err.message}`);
      sourceStats.push({ id: source.id, label: source.label, count: 0, error: String(err.message) });
      failedSources.push(`${source.id} (${err.message})`);
    }
  }

  // Surcharges humaines: brokers ajoutés à la main (UE/FR notamment) et
  // corrections de données erronees venant des sources publiques.
  const overrideDocs = await readYamlDir(cfg.localDirectories.overrides);
  const manualEntries = [];
  const patches = new Map(); // domaine -> patch
  for (const { file, doc } of overrideDocs) {
    for (const b of doc.brokers ?? []) {
      if (b.patch) {
        const key = registrableDomain(b.domain || b.website || '') || `name:${slugify(b.name)}`;
        patches.set(key, { ...b, _file: file });
      } else {
        manualEntries.push({ source: 'manual', regions: ['eu'], ...b, _file: file });
      }
    }
  }
  collected.push(...manualEntries);
  if (manualEntries.length || patches.size) {
    sourceStats.push({ id: 'overrides', label: 'Surcharges du dépôt', count: manualEntries.length + patches.size });
  }

  // Recettes d'automatisation navigateur, indexees par domaine cible.
  const recipeDocs = await readYamlDir(cfg.localDirectories.recipes);
  const recipes = new Map();
  for (const { file, doc } of recipeDocs) {
    const list = Array.isArray(doc) ? doc : doc.recipes ?? [doc];
    for (const r of list) {
      if (!r?.id || !r?.domain) throw new Error(`Recette invalide dans ${file}: id et domain requis`);
      recipes.set(registrableDomain(r.domain), r);
    }
  }
  console.log(`Recettes d'automatisation: ${recipes.size}`);

  // --- fusion -------------------------------------------------------------
  const merged = new Map();
  for (const rec of collected) {
    if (!rec.name) continue;
    const key = mergeKey(rec);
    const prev = merged.get(key);
    if (!prev) {
      // Une fiche marquee "enrichissement seul" complete un courtier existant,
      // elle n'en cree jamais. Sans cela, on importerait des eglises et des
      // ecoles, qui figurent dans cette base sans revendre quoi que ce soit.
      if (rec.enrichOnly) continue;
      merged.set(key, {
        ...rec,
        email: isUsableEmail(rec.email) ? rec.email.toLowerCase().trim() : undefined,
        regions: [...new Set(rec.regions ?? ['us'])],
        sources: [rec.source],
        _optOutFrom: rec.optOutUrl ? rec.source : null,
      });
      continue;
    }
    // Fusion champ par champ: on garde la meilleure valeur disponible.
    prev.sources = [...new Set([...prev.sources, rec.source])];
    prev.regions = [...new Set([...prev.regions, ...(rec.regions ?? [])])];
    prev.email = betterEmail(prev.email, rec.email);
    prev.website = prev.website || rec.website;
    // Le registre CPPA pointe la page "vos droits", souvent une politique de
    // confidentialité générique. Optery documente la vraie page d'opt-out:
    // elle doit gagner même si CPPA a été lu en premier.
    if (rec.optOutUrl && URL_SOURCE_RANK[rec.source] > URL_SOURCE_RANK[prev._optOutFrom ?? 'none']) {
      prev.optOutUrl = rec.optOutUrl;
      prev._optOutFrom = rec.source;
    }
    prev.optOutUrl = prev.optOutUrl || rec.optOutUrl;
    prev.privacyUrl = prev.privacyUrl || rec.privacyUrl;
    prev.guideUrl = prev.guideUrl || rec.guideUrl;
    prev.videoUrl = prev.videoUrl || rec.videoUrl;
    prev.description = prev.description || rec.description;
    prev.legalName = prev.legalName || rec.legalName;
    prev.registeredCA = prev.registeredCA || rec.registeredCA;
    prev.reach = prev.reach || rec.reach;
    prev.sensitive = [...new Set([...(prev.sensitive ?? []), ...(rec.sensitive ?? [])])];
    // Les marques secondaires viennent de sources differentes: on les cumule,
    // c'est ce qui permet de retrouver une societe sous n'importe quel nom.
    prev.aliases = [...new Set([...(prev.aliases ?? []), ...(rec.aliases ?? [])])];
    // Le nom commercial d'Optery est plus lisible que la raison sociale CPPA.
    if (rec.source === 'optery' && rec.name) prev.name = rec.name;
    // Une entree ecrite a la main dans catalog/overrides tranche: elle vient de
    // quelqu'un qui a regarde ce que fait vraiment la societe, la ou les
    // sources publiques rangent tout l'adtech sous "marketing".
    if (rec.source === 'manual') {
      if (rec.category) prev.category = rec.category;
      if (rec.notes) prev.notes = rec.notes;
      if (rec.email) prev.email = rec.email;
      if (rec.optOutUrl) { prev.optOutUrl = rec.optOutUrl; prev._optOutFrom = 'manual'; }
    } else if ((!prev.category || prev.category === 'other') && rec.category) {
      // Sinon, la catégorie précise l'emporte seulement sur "other".
      prev.category = rec.category;
    }
  }

  // --- mise en forme finale ------------------------------------------------
  const enrichment = (await readJsonSafe(path.join(CATALOG_DIR, 'enrichment.json'))) ?? {};
  verdictsRgpd = (await readJsonSafe(path.join(CATALOG_DIR, 'rgpd.json'))) ?? {};
  const previous = await loadPrevious();
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  const seenIds = new Set();
  // Entrees ecartees parce qu elles ne concernent pas une personne en Europe.
  let ecartes = 0;
  let eteints = 0;

  for (const [key, rec] of merged) {
    const domain = key.startsWith('name:') ? '' : key;
    const patch = patches.get(key) ?? patches.get(`name:${slugify(rec.name)}`);
    if (patch?.remove) continue;
    const withPatch = { ...rec, ...(patch ?? {}) };
    delete withPatch.patch;
    delete withPatch._file;

    const recipe = recipes.get(domain);
    let id = slugify(domain || withPatch.name) || slugify(withPatch.name);
    while (seenIds.has(id)) id = `${id}-2`;
    seenIds.add(id);

    const entry = {
      id,
      name: withPatch.name,
      aliases: withPatch.aliases?.length
        ? [...new Set(withPatch.aliases.filter((a) => a && a !== withPatch.name))].slice(0, 12)
        : undefined,
      domain: domain || undefined,
      website: withPatch.website ? normalizeUrl(withPatch.website) : undefined,
      category: withPatch.category || 'other',
      regions: withPatch.regions?.length ? withPatch.regions : ['us'],
      // Adresse trouvee dans la politique de confidentialite du courtier par
      // scripts/enrich-catalog.mjs, quand aucune source ouverte n'en publiait.
      email: withPatch.email ?? enrichment[domain]?.email ?? undefined,
      // A defaut d'adresse, la page de confidentialite reellement lue par
      // l'enrichissement: un lien verifie vaut mieux qu'une URL devinee.
      // A defaut d'URL connue, le portail d'exercice des droits trouve dans la
      // politique de confidentialite. Contrairement a la politique elle-meme,
      // c'est une page ou l'on depose vraiment une demande.
      optOutUrl: withPatch.optOutUrl
        ? normalizeUrl(withPatch.optOutUrl)
        : (enrichment[domain]?.optOutUrl ? normalizeUrl(enrichment[domain].optOutUrl) : undefined),
      // La page trouvee par l'enrichissement est une politique de
      // confidentialite, pas un formulaire. La ranger dans optOutUrl faisait
      // croire a l'application qu'un formulaire existait, et elle envoyait
      // l'utilisateur lire un texte de loi en pensant lui ouvrir un formulaire.
      // La politique publiee par la source prime sur celle devinee par
      // l'enrichissement: un fournisseur TCF declare lui-meme la sienne.
      privacyUrl: withPatch.privacyUrl
        ? normalizeUrl(withPatch.privacyUrl)
        : (enrichment[domain]?.privacyUrl ? normalizeUrl(enrichment[domain].privacyUrl) : undefined),
      guideUrl: withPatch.guideUrl,
      videoUrl: withPatch.videoUrl,
      legalName: withPatch.legalName,
      description: shorten(withPatch.description),
      registeredCA: withPatch.registeredCA || undefined,
      sensitive: withPatch.sensitive?.length ? withPatch.sensitive : undefined,
      requiresId: withPatch.requiresId || undefined,
      notes: withPatch.notes,
      recipe: recipe ? recipe.id : undefined,
      sources: withPatch.sources ?? ['manual'],
      firstSeen: previous.get(id)?.firstSeen ?? today,
    };
    entry.methods = methodsFor({ ...entry, recipe: entry.recipe });
    entry.score = riskScore(entry);
    entry.euRelevant = isEuRelevant(entry) || undefined;

    // Le catalogue est celui d'un outil francais et europeen: ce qui ne
    // concerne pas une personne vivant en Europe n'y figure pas.
    if (!concerneEurope(entry)) { ecartes++; continue; }

    // Domaine qui ne resout plus et aucun contact connu par ailleurs: la
    // societe a disparu ou change de nom. La garder ne produirait que des
    // demandes perdues. Une simple indisponibilite ne suffit pas: le site doit
    // etre injoignable, et non seulement ferme aux robots. Si un examen
    // ulterieur le retrouve vivant, l'entree revient d'elle-meme, le catalogue
    // etant reconstruit depuis les sources a chaque fois.
    if (
      !entry.email && !entry.optOutUrl
      && enrichment[domain]?.reason?.startsWith('domaine éteint')
    ) { eteints++; continue; }

    // La France d'abord: c'est la cible declaree du projet, et une demande a
    // une societe francaise aboutit plus souvent qu'a une societe lointaine.
    entry.france = entry.regions.includes('fr') || undefined;

    entries.push(entry);
  }

  entries.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));

  const added = entries.filter((e) => !previous.has(e.id)).map((e) => e.id);
  const removed = [...previous.keys()].filter((id) => !seenIds.has(id));

  // Garde-fou contre l'effondrement du catalogue.
  //
  // Ce script tourne chaque semaine sans surveillance et son résultat est
  // publié tel quel: si une source disparaît, change d'URL ou répond 404, le
  // catalogue se vide et chaque installation télécharge la version amputée.
  // Une perte massive traduit une panne de source, jamais une évolution
  // réelle du marché. Mieux vaut garder le catalogue de la semaine passée.
  // La comparaison porte sur la taille du catalogue produit, et non sur les
  // seules entrées absentes des sources: une entrée peut être lue puis écartée
  // par un filtre, auquel cas `removed` reste à zéro alors que le catalogue
  // maigrit. Mesurer l'écart réel est le seul moyen de tenir la promesse.
  /**
   * Une source en panne rend le catalogue incomplet par construction.
   *
   * L'ancienne version continuait sans elle et publiait le résultat: l'URL du
   * répertoire Optery pointait vers une branche inexistante, la source
   * répondait 404 à chaque exécution hebdomadaire, et trois cents entrées
   * disparaissaient du catalogue de tous les utilisateurs sans que rien ne le
   * signale. La perte, à 3 %, passait sous le seuil de garde.
   *
   * Publier un catalogue amputé est pire que ne rien publier: la semaine
   * précédente reste servie, et les demandes continuent de partir.
   */
  if (failedSources.length && !args.includes('--force')) {
    console.error(`\nRefus d'écrire: ${failedSources.length} source(s) en échec: ${failedSources.join(', ')}.`);
    console.error('Le catalogue precedent est conserve. Corrigez la source, ou relancez avec --force.');
    process.exitCode = 1;
    return;
  }

  const SEUIL_PERTE = 0.2;
  const perdues = Math.max(previous.size - entries.length, removed.length);
  if (previous.size && perdues > previous.size * SEUIL_PERTE && !args.includes('--force')) {
    const part = Math.round((perdues / previous.size) * 100);
    console.error(
      `\nRefus d'écrire: le catalogue passerait de ${previous.size} à ${entries.length} entrées (${part} % de perte).`,
    );
    console.error("Une source est probablement en panne. Le catalogue precedent est conserve.");
    console.error('Si la perte est voulue, relancez avec --force.');
    process.exitCode = 1;
    return;
  }

  const catalogPath = path.join(CATALOG_DIR, 'catalog.json');
  const body = JSON.stringify({ brokers: entries, recipes: [...recipes.values()] }, null, 0);
  const sha256 = createHash('sha256').update(body).digest('hex');
  await fs.writeFile(catalogPath, body);

  const prevIndex = await readJsonSafe(path.join(CATALOG_DIR, 'index.json'));
  const index = {
    revision: (prevIndex?.revision ?? 0) + 1,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    sha256,
    sources: sourceStats,
    stats: statsOf(entries),
    added,
    removed,
  };
  await fs.writeFile(path.join(CATALOG_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  console.log('');
  console.log(`Catalogue: ${entries.length} brokers uniques (revision ${index.revision})`);
  console.log(`  avec email        : ${index.stats.withEmail}`);
  console.log(`  avec URL opt-out  : ${index.stats.withForm}`);
  console.log(`  automatisables    : ${index.stats.withRecipe}`);
  console.log(`  dont France       : ${index.stats.france}`);
  console.log(`  ecartes (hors UE) : ${ecartes}`);
  console.log(`  domaines eteints  : ${eteints}`);
  console.log(`  nouveaux          : ${added.length}`);
  console.log(`  disparus          : ${removed.length}`);
}

function statsOf(entries) {
  const byCategory = {};
  const byRegion = {};
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    for (const r of e.regions) byRegion[r] = (byRegion[r] ?? 0) + 1;
  }
  return {
    withEmail: entries.filter((e) => e.email).length,
    withForm: entries.filter((e) => e.optOutUrl).length,
    withRecipe: entries.filter((e) => e.recipe).length,
    registeredCA: entries.filter((e) => e.registeredCA).length,
    euRelevant: entries.filter((e) => e.euRelevant).length,
    france: entries.filter((e) => e.france).length,
    byCategory,
    byRegion,
  };
}

/**
 * Le registre CPPA contient souvent plusieurs URL dans une seule cellule
 * ("https://a/privacy; https://a/notice"). On ne garde que la première validé,
 * sinon l'interface ouvre un lien casse.
 */
function normalizeUrl(raw) {
  const first = String(raw ?? '')
    .split(/[;\s]+|,(?=https?:)/i)
    .map((s) => s.trim().replace(/^["'<]+|["'>.,]+$/g, ''))
    .find((s) => s.length > 3);
  if (!first) return undefined;
  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Les descriptions d'Optery font parfois 2000 caractères: on garde l'essentiel. */
function shorten(text, max = 320) {
  if (!text) return undefined;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '...';
}

async function readJsonSafe(p) {
  try {
    // La marque d'ordre des octets ajoutee par certains editeurs Windows fait
    // echouer JSON.parse: on la retire avant lecture.
    return JSON.parse((await fs.readFile(p, 'utf8')).replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** Conserve la date de première apparition pour signaler les nouveautes. */
async function loadPrevious() {
  const prev = await readJsonSafe(path.join(CATALOG_DIR, 'catalog.json'));
  const map = new Map();
  for (const b of prev?.brokers ?? []) map.set(b.id, b);
  return map;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
