#!/usr/bin/env node
/**
 * Complète le catalogue en cherchant l'adresse de contact vie privée des
 * courtiers qui n'en publient pas dans les sources ouvertes.
 *
 * Pourquoi ce script existe: le registre CPPA et l'annuaire Optery couvrent
 * bien les États-Unis, beaucoup moins l'Europe. Pour un courtier européen, la
 * seule adresse fiable est celle publiée dans sa propre politique de
 * confidentialité, comme l'impose l'article 13 du RGPD. Ce script va la lire.
 *
 * Il tourne en intégration continue, pas chez l'utilisateur: personne n'a
 * besoin d'émettre des requêtes vers des centaines de sites depuis son
 * ordinateur pour obtenir une information identique pour tout le monde.
 *
 *   node scripts/enrich-catalog.mjs                  # courtiers sans adresse
 *   node scripts/enrich-catalog.mjs --only eu        # Europe seulement
 *   node scripts/enrich-catalog.mjs --refresh 90     # revérifie après 90 jours
 *   node scripts/enrich-catalog.mjs --limit 50
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrableDomain, isUsableEmail } from './lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'catalog', 'catalog.json');
const ENRICHMENT = path.join(ROOT, 'catalog', 'enrichment.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LIMIT = Number(flag('limit', '400'));
const ONLY = flag('only', '');
const REFRESH_DAYS = Number(flag('refresh', '120'));
const CONCURRENCY = 6;

/** Chemins où une politique de confidentialité se trouve presque toujours. */
const CANDIDATE_PATHS = [
  '/privacy', '/privacy-policy', '/privacy-notice', '/legal/privacy',
  '/politique-de-confidentialite', '/confidentialite', '/vie-privee',
  '/mentions-legales', '/datenschutz', '/privacybeleid', '/privacidad',
  '/legal', '/gdpr', '/rgpd', '/',
];

/**
 * Adresses d'exemple présentes dans les politiques de confidentialité.
 * Elles ressemblent à des contacts valides mais n'existent pas: écrire à
 * john.doe@ ne fait que produire un rebond des semaines plus tard.
 */
const PLACEHOLDER = new RegExp([
  '^(john|jane)[._-]?doe$',
  // Équivalents français, allemands et espagnols du "John Doe" des exemples.
  '^(jean|marie|pierre|paul|jacques|sophie|max|erika|juan)[._-](dupont|durand|martin|dupond|mustermann|musterfrau|perez)$',
  '^(prenom|nom)[._-](nom|prenom)$',
  '^(firstname|lastname|votre[._-]?nom|exemple|example|sample|test|user|utilisateur|email|adresse|nomprenom)$',
].join('|'), 'i');

function isPlaceholderEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  return PLACEHOLDER.test(local) || /exemple\.|example\./.test(email);
}

/** Une adresse dédiée vaut mieux qu'un standard commercial. */
function scoreEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (/^(dpo|dpd|datenschutz|delegue|rgpd|gdpr|dataprotection|data-protection|privacy|privacidad|privacyofficer)/.test(local)) return 5;
  if (/(privacy|rgpd|gdpr|dpo|donnees|datenschutz)/.test(local)) return 4;
  if (/^(legal|compliance|juridique)/.test(local)) return 3;
  if (/^(contact|info|hello|bonjour|support|help|service)/.test(local)) return 2;
  return 1;
}

/**
 * Résultat de la dernière tentative réseau, partagé pour distinguer trois
 * situations qui se ressemblent mais n'appellent pas la même décision:
 *   - 'html'     la page a été lue
 *   - 'bloque'   le serveur a répondu, mais refuse un robot (403, 429, captcha)
 *   - 'absent'   le domaine ne résout plus: la société a probablement disparu
 */
let lastFailure = 'absent';

async function fetchText(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Identification honnête: un administrateur qui consulte ses journaux
        // doit pouvoir comprendre d'où vient la requête.
        'user-agent': 'RemoveBroker-catalog/1.0 (+https://github.com/RDSV01/RemoveBroker) privacy-contact-discovery',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr,en;q=0.8',
      },
    });
    // Le serveur a répondu: le domaine vit, même si la réponse est un refus.
    if (lastFailure === 'absent') lastFailure = 'bloque';
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text')) return null;
    const text = await res.text();
    return text.slice(0, 600_000);
  } catch (err) {
    // Un domaine qui ne résout plus, ou dont le certificat a expiré depuis
    // longtemps, signale une société qui n'existe plus. Un dépassement de
    // délai, lui, ne prouve rien.
    const code = err?.cause?.code ?? '';
    if (['ENOTFOUND', 'EAI_AGAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code) === false && lastFailure === 'absent') {
      lastFailure = 'bloque';
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adresses qui traitent la vie privée sans appartenir au domaine du courtier.
 *
 * Beaucoup de sociétés européennes externalisent leur délégué à la protection
 * des données, ou centralisent les demandes au niveau du groupe. Exiger que
 * l'adresse porte le domaine du site écartait ces cas, et l'utilisateur se
 * retrouvait devant un « aucun contact » alors que la page en donnait un.
 */
const PRIVACY_LOCAL = /^(dpo|dpd|dsr|datenschutz|data[\s._-]?protection|privacy|privacidad|vie[\s._-]?privee|rgpd|gdpr|ccpa|donnees[\s._-]?personnelles|delegue)/i;

/** Extrait les adresses de contact vie privée trouvées sur la page. */
function extractEmails(html, domain) {
  const found = new Map();
  const push = (raw) => {
    const email = raw.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    if (!isUsableEmail(email)) return;
    if (isPlaceholderEmail(email)) return;

    const emailDomain = registrableDomain(email.split('@')[1] ?? '');
    const local = email.split('@')[0];
    const sameHouse = emailDomain === domain
      // Même marque sur un autre suffixe: placer.ai et placerai.com.
      || emailDomain.replace(/[.-]/g, '').startsWith(domain.split('.')[0].replace(/[.-]/g, ''));

    // Une adresse d'un autre domaine n'est retenue que si son intitulé dit
    // explicitement qu'elle traite la protection des données: un prestataire
    // externe s'appelle dpo@..., jamais contact@.
    if (!sameHouse && !PRIVACY_LOCAL.test(local)) return;

    // Une adresse externe reste moins sûre qu'une adresse maison.
    found.set(email, scoreEmail(email) - (sameHouse ? 0 : 1));
  };

  for (const m of html.matchAll(/mailto:([^"'<>\s)]+)/gi)) push(m[1]);
  for (const m of html.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) push(m[0]);

  // Adresses écrites en toutes lettres pour échapper aux robots. Les formes
  // varient beaucoup: « dpo [at] exemple [dot] com », « dpo ((at)) exemple
  // ((dot)) com ». The Trade Desk emploie la seconde, le registre californien
  // la première; les ignorer laissait ces courtiers sans contact.
  const AT = String.raw`\s*(?:\[at\]|\(at\)|\(\(at\)\)|&#64;|\bat\b)\s*`;
  const DOT = String.raw`\s*(?:\[dot\]|\(dot\)|\(\(dot\)\)|\bdot\b|\bpoint\b)\s*`;
  const obfusque = new RegExp(
    String.raw`([\w.+-]+)${AT}([\w-]+)(?:${DOT}|\.)([\w-]+)(?:(?:${DOT}|\.)([a-z]{2,}))?`,
    'gi',
  );
  for (const m of html.matchAll(obfusque)) {
    const parties = [m[2], m[3], m[4]].filter(Boolean);
    push(`${m[1]}@${parties.join('.')}`);
  }

  return [...found.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Cherche, dans une politique de confidentialité, le lien vers le vrai
 * formulaire d'exercice des droits.
 *
 * C'est le chaînon qui manquait: la politique dit rarement « écrivez-nous »,
 * elle renvoie vers un portail de demande. Ce lien-là est actionnable, la
 * politique ne l'est pas.
 */
const RIGHTS_LINK = /(opt[\s-]?out|do[\s-]?not[\s-]?sell|privacy[\s-]?(request|center|centre|choices)|data[\s-]?(request|subject)|dsar|deletion[\s-]?request|erasure|submit[\s-]?a[\s-]?request|exercer[\s-]?vos[\s-]?droits|formulaire[\s-]?de[\s-]?demande|mes[\s-]?droits)/i;

/**
 * Pages d'opt-out mutualisées du secteur publicitaire.
 *
 * Une politique de confidentialité les cite presque toujours, mais elles ne
 * traitent pas une demande auprès de ce courtier-là: elles désactivent le
 * ciblage à l'échelle d'un consortium, ce qui n'efface rien. Les retenir
 * enverrait l'utilisateur cliquer sur un opt-out publicitaire en croyant
 * demander une suppression.
 */
const SHARED_OPTOUT = /(tools\.google\.com|aboutads\.info|youronlinechoices|networkadvertising\.org|youradchoices|optout\.privacyrights|adssettings\.google|facebook\.com|linkedin\.com)/i;

/** Plateformes spécialisées qui hébergent les portails de demande. */
const DSAR_PLATFORM = /(onetrust|trustarc|securiti\.ai|osano|ketch\.com|transcend\.io|didomi|usercentrics|privacyportal|submit-irm|dsar)/i;

function rightsFormLink(html, baseUrl, domain) {
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const [, href, label] = m;
    const text = label.replace(/<[^>]+>/g, ' ');
    if (!RIGHTS_LINK.test(href) && !RIGHTS_LINK.test(text)) continue;
    // La politique elle-même n'est pas un formulaire.
    if (/privacy-?policy|politique-de-confidentialite|privacy-?notice|\/terms/i.test(href)) continue;

    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }

    // Un lien qui pointe la page courante n'est qu'une ancre interne.
    if (url.href.split('#')[0] === baseUrl.split('#')[0]) continue;
    if (SHARED_OPTOUT.test(url.hostname)) continue;

    // Le portail doit appartenir au courtier, ou à une plateforme de gestion
    // des demandes qu'il a mandatée.
    const sameHouse = registrableDomain(url.hostname) === domain;
    if (!sameHouse && !DSAR_PLATFORM.test(url.hostname + url.pathname)) continue;

    return url.toString();
  }
  return null;
}

/** Trouve les liens vers les pages de confidentialité depuis l'accueil. */
function privacyLinks(html, baseUrl) {
  const links = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!/privacy|confidentialit|vie-privee|datenschutz|privacidad|gdpr|rgpd|donnees-personnelles|mentions-legales/i.test(href + label)) continue;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      /* lien relatif invalide */
    }
  }
  return [...links].slice(0, 4);
}

async function discover(broker) {
  const domain = broker.domain || registrableDomain(broker.website ?? '');
  if (!domain) return { email: null, reason: 'aucun domaine' };

  const origin = broker.website?.startsWith('http') ? new URL(broker.website).origin : `https://${domain}`;
  const tried = new Set();
  // Distinguer "le site ne publie pas d'adresse" de "le site ne repond plus":
  // dans le second cas la societe a probablement disparu, et l'entree doit
  // sortir du catalogue plutot que rester a produire des envois perdus.
  let reachable = false;
  lastFailure = 'absent';
  const visit = async (url) => {
    if (tried.has(url) || tried.size > 8) return null;
    tried.add(url);
    const html = await fetchText(url);
    if (!html) return null;
    reachable = true;
    const emails = extractEmails(html, domain);
    if (emails.length) return { email: emails[0][0], source: url, score: emails[0][1] };
    return { html, url };
  };

  let homepage = null;
  // Page de confidentialité effectivement lue: à défaut d'adresse, c'est au
  // moins un lien vérifié vers lequel envoyer l'utilisateur, au lieu d'une URL
  // devinée qui aboutirait sur une erreur.
  let privacyUrl = null;
  // Lien vers le portail d'exercice des droits, trouve dans la politique.
  let optOutUrl = null;

  // Les entrées venues du registre TCF portent l'URL que la société y a
  // déclarée elle-même. La lire vaut mieux que deviner un chemin: c'est la
  // page que l'entreprise désigne comme sa politique, et elle est souvent
  // ailleurs que sur /privacy.
  if (broker.privacyUrl) {
    const declared = await visit(broker.privacyUrl);
    if (declared?.email) {
      return { email: declared.email, source: declared.source, optOutUrl, reason: 'politique déclarée au registre' };
    }
    if (declared?.html) {
      privacyUrl = declared.url;
      optOutUrl = rightsFormLink(declared.html, declared.url, domain);
    }
  }

  for (const candidate of CANDIDATE_PATHS) {
    const result = await visit(origin + candidate);
    if (result?.email) return { email: result.email, source: result.source, optOutUrl, reason: 'page de confidentialité' };
    if (candidate === '/' && result?.html) homepage = result;
    if (result?.html && candidate !== '/' && !privacyUrl) privacyUrl = result.url;
    if (result?.html && !optOutUrl) optOutUrl = rightsFormLink(result.html, result.url, domain);
  }

  // Le portail trouve dans la politique est souvent la vraie porte d'entree:
  // on va y chercher une adresse avant d'abandonner.
  if (optOutUrl) {
    const result = await visit(optOutUrl);
    if (result?.email) return { email: result.email, source: result.source, optOutUrl, reason: 'portail de demande' };
  }

  // Rien dans les chemins classiques: on suit les liens de l'accueil.
  if (homepage) {
    for (const link of privacyLinks(homepage.html, homepage.url)) {
      const result = await visit(link);
      if (result?.email) return { email: result.email, source: result.source, optOutUrl, reason: 'lien depuis l accueil' };
      if (result?.html && !optOutUrl) optOutUrl = rightsFormLink(result.html, result.url, domain);
    }
  }

  if (reachable) {
    return {
      email: null,
      privacyUrl,
      optOutUrl,
      reason: optOutUrl ? 'portail de demande trouvé, sans adresse' : 'aucune adresse publiée',
    };
  }
  return {
    email: null,
    reason: lastFailure === 'bloque'
      ? 'site actif mais fermé aux robots'
      : 'domaine éteint, société probablement disparue',
  };
}

async function main() {
  // Un éditeur Windows peut préfixer le fichier d'une marque d'ordre des
  // octets: sans ce nettoyage, JSON.parse échoue et l'enrichissement accumulé
  // serait silencieusement écrasé.
  const readJson = async (file) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));

  const catalog = await readJson(CATALOG);
  let enrichment = {};
  try {
    enrichment = await readJson(ENRICHMENT);
  } catch {
    /* première exécution */
  }

  const staleBefore = Date.now() - REFRESH_DAYS * 86_400_000;
  // --domains sert à réexaminer une liste précise, par exemple après avoir
  // ajouté un lot d'entrées: sans lui, le tri par pertinence les noierait.
  const wanted = new Set((flag('domains', '') || '').split(',').filter(Boolean));
  const category = flag('category', '');

  const targets = catalog.brokers
    .filter((b) => (wanted.size ? wanted.has(b.domain) : !b.email))
    .filter((b) => (category ? b.category === category : true))
    .filter((b) => b.domain || b.website)
    .filter((b) => (ONLY ? b.regions.includes(ONLY) : true))
    .filter((b) => {
      if (wanted.size) return true;
      const known = enrichment[b.domain ?? b.id];
      if (!known) return true;
      return new Date(known.checkedAt).getTime() < staleBefore;
    })
    // La France d'abord, puis l'Europe: ce sont les zones les moins couvertes
    // par les sources ouvertes, et celles qui comptent pour l'utilisateur.
    .sort(
      (a, b) =>
        Number(b.regions.includes('fr')) - Number(a.regions.includes('fr')) ||
        Number(b.regions.includes('eu')) - Number(a.regions.includes('eu')) ||
        b.score - a.score,
    )
    .slice(0, LIMIT);

  console.log(`${targets.length} courtiers à examiner (sur ${catalog.brokers.length})`);

  let found = 0;
  let done = 0;
  const queue = [...targets];

  const worker = async () => {
    for (;;) {
      const broker = queue.shift();
      if (!broker) return;
      const result = await discover(broker);
      const key = broker.domain ?? broker.id;
      enrichment[key] = {
        email: result.email ?? null,
        privacyUrl: result.privacyUrl ?? null,
        optOutUrl: result.optOutUrl ?? null,
        source: result.source ?? null,
        reason: result.reason,
        checkedAt: new Date().toISOString(),
      };
      done++;
      if (result.email) {
        found++;
        console.log(`  ${broker.name}: ${result.email}`);
      }
      if (done % 25 === 0) console.log(`  ... ${done}/${targets.length}`);
      // Politesse: on ne martèle pas les serveurs des courtiers.
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await fs.writeFile(ENRICHMENT, JSON.stringify(enrichment, null, 1) + '\n');

  console.log('');
  console.log(`${found} adresses trouvées sur ${done} sites consultés.`);
  console.log('Relancez node scripts/build-catalog.mjs pour les intégrer au catalogue.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
