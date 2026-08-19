#!/usr/bin/env node
/**
 * Détermine si une société non européenne traite des données européennes.
 *
 * Le drapeau de région ne suffit pas à trancher. Une société américaine peut
 * être hors sujet pour une personne vivant en France, ou au contraire détenir
 * ses déplacements: Outlogic, Veraset et Safegraph achètent de la localisation
 * à des applications du monde entier, sans jamais figurer dans une liste
 * européenne.
 *
 * Le seul critère honnête est ce que la société déclare elle-même. Une
 * politique de confidentialité qui consacre une section au RGPD, aux droits
 * des résidents de l'Espace économique européen ou aux clauses contractuelles
 * types reconnaît un traitement de données européennes, et donc l'obligation
 * de répondre. Une politique qui n'évoque que la Californie et le Virginia ne
 * concerne pas quelqu'un qui n'a jamais vécu aux États-Unis.
 *
 *   node scripts/detect-rgpd.mjs              # les entrees sans region europeenne
 *   node scripts/detect-rgpd.mjs --limit 50
 *   node scripts/detect-rgpd.mjs --refresh 90 # revérifie les verdicts anciens
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'catalog', 'catalog.json');
const VERDICTS = path.join(ROOT, 'catalog', 'rgpd.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LIMIT = Number(flag('limit', '1000'));
const REFRESH_DAYS = Number(flag('refresh', '180'));
const CONCURRENCY = 6;

/**
 * Marqueurs d'un traitement de données européennes.
 *
 * Chacun engage la société: on ne cite pas les clauses contractuelles types ou
 * le représentant au sens de l'article 27 sans transférer de données depuis
 * l'Union.
 */
const MARQUEURS = [
  /\bGDPR\b/i,
  /\bRGPD\b/i,
  /general data protection regulation/i,
  /r[eè]glement g[eé]n[eé]ral sur la protection des donn[eé]es/i,
  /european economic area/i,
  /\bEEA\b/,
  /EU[\s-]?U\.?S\.? data privacy framework/i,
  /standard contractual clauses/i,
  /clauses contractuelles types/i,
  /supervisory authority/i,
  /autorit[eé] de contr[oô]le/i,
  /data protection officer/i,
  /d[eé]l[eé]gu[eé] [aà] la protection des donn[eé]es/i,
  /article 27 representative/i,
  /residents? of the european union/i,
];

/** Une seule mention isolée peut être un copier-coller: on en exige deux. */
const MARQUEURS_REQUIS = 2;

const CHEMINS = [
  '/privacy', '/privacy-policy', '/privacy-notice', '/legal/privacy',
  '/privacy-center', '/gdpr', '/legal', '/',
];

async function lire(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'RemoveBroker-catalog/1.0 (+https://github.com/RDSV01/RemoveBroker) gdpr-scope-check',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text')) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Signes qu'on a bien sous les yeux une politique de confidentialité.
 *
 * Sans ce contrôle, une page d'accueil ou un sélecteur de langue sans le
 * moindre texte juridique passait pour une politique sans mention du droit
 * européen, et la société était écartée à tort. Constaté sur Choreograph,
 * filiale de WPP, dont la page ne sert que neuf mille caractères de menu et
 * qui répond pourtant aux demandes.
 */
const SIGNES_POLITIQUE = [
  /personal (information|data)/i,
  /donn[eé]es (personnelles|à caract[eè]re personnel)/i,
  /we (collect|process|share)/i,
  /nous (collectons|traitons)/i,
  /\bcookies?\b/i,
  /third[- ]part(y|ies)/i,
];

function texteDe(html) {
  // Le texte seul: une balise ou un script contenant "gdpr" dans un nom de
  // classe ne dit rien du traitement.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function estUnePolitique(texte) {
  return texte.length > 1500 && SIGNES_POLITIQUE.filter((s) => s.test(texte)).length >= 3;
}

function marqueursTrouves(texte) {
  return MARQUEURS.filter((m) => m.test(texte)).map((m) => m.source);
}

async function examiner(broker) {
  const origine = broker.website?.startsWith('http')
    ? new URL(broker.website).origin
    : `https://${broker.domain}`;

  const candidats = broker.privacyUrl ? [broker.privacyUrl, ...CHEMINS.map((c) => origine + c)] : CHEMINS.map((c) => origine + c);
  const vus = new Set();
  let joignable = false;
  // Une politique doit avoir été réellement lue avant d'écarter la société:
  // l'absence de marqueur sur une page de menu ne prouve rien.
  let politiqueLue = null;

  for (const url of candidats) {
    if (vus.has(url) || vus.size > 5) break;
    vus.add(url);
    const html = await lire(url);
    if (!html) continue;
    joignable = true;
    const texte = texteDe(html);
    const trouves = marqueursTrouves(texte);
    if (trouves.length >= MARQUEURS_REQUIS) {
      return { europe: true, marqueurs: trouves.slice(0, 4), source: url };
    }
    if (!politiqueLue && estUnePolitique(texte)) politiqueLue = url;
  }

  if (politiqueLue) {
    return { europe: false, marqueurs: [], raison: 'aucune mention du droit europeen', source: politiqueLue };
  }
  return {
    europe: null,
    marqueurs: [],
    raison: joignable ? 'politique introuvable sans navigateur' : 'site injoignable',
  };
}

async function main() {
  const catalogue = JSON.parse(await fs.readFile(CATALOG, 'utf8'));
  let verdicts = {};
  try {
    verdicts = JSON.parse(await fs.readFile(VERDICTS, 'utf8'));
  } catch {
    /* premier passage */
  }

  const perime = Date.now() - REFRESH_DAYS * 86_400_000;
  const cibles = catalogue.brokers
    .filter((b) => !['fr', 'eu', 'uk'].some((z) => b.regions.includes(z)))
    .filter((b) => !b.sources.includes('tcf'))
    .filter((b) => b.domain || b.website)
    .filter((b) => {
      const connu = verdicts[b.domain];
      return !connu || new Date(connu.checkedAt).getTime() < perime;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  console.log(`${cibles.length} societes hors Europe a examiner (sur ${catalogue.brokers.length})`);

  let europe = 0;
  let hors = 0;
  let muets = 0;
  let faits = 0;
  const file = [...cibles];

  const ouvrier = async () => {
    for (;;) {
      const broker = file.shift();
      if (!broker) return;
      const r = await examiner(broker);
      verdicts[broker.domain] = { ...r, checkedAt: new Date().toISOString() };
      faits++;
      if (r.europe === true) europe++;
      else if (r.europe === false) hors++;
      else muets++;
      if (faits % 50 === 0) console.log(`  ... ${faits}/${cibles.length}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, ouvrier));
  await fs.writeFile(VERDICTS, JSON.stringify(verdicts, null, 1) + '\n');

  console.log(`\ntraitent des donnees europeennes : ${europe}`);
  console.log(`n'evoquent que le droit americain: ${hors}`);
  console.log(`site injoignable, verdict reporte: ${muets}`);
  console.log('Relancez node scripts/build-catalog.mjs pour appliquer.');
}

await main();
