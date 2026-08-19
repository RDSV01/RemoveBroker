#!/usr/bin/env node
/**
 * Génère build/icon.png, l'icône de l'application de bureau.
 *
 * Un fichier binaire dans un dépôt public est un fichier qu'on ne peut pas
 * relire. Ici l'icône est décrite par du code: on voit ce qu'elle contient, et
 * la changer revient à changer trois constantes.
 *
 *   node scripts/make-icon.mjs [taille]
 */

import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = Number(process.argv[2] ?? 512);

const BACKGROUND = [14, 124, 134]; // teal de l'interface
const FOREGROUND = [255, 255, 255];
const CORNER = 0.22; // rayon des coins, en fraction du côté

/**
 * Bouclier: épaules droites en haut, flancs qui se referment vers une pointe.
 * Le profil renvoie la demi-largeur autorisée à une hauteur donnée.
 */
const SHOULDER = 0.62; // demi-largeur des flancs
const CORNER_TOP = 0.18; // arrondi des deux coins hauts

function halfWidth(sy) {
  if (sy < -1 || sy > 1) return 0;
  if (sy < -1 + CORNER_TOP) {
    const dy = sy - (-1 + CORNER_TOP);
    return SHOULDER - CORNER_TOP + Math.sqrt(Math.max(0, CORNER_TOP ** 2 - dy ** 2));
  }
  if (sy <= 0.15) return SHOULDER;
  // Courbe en cosinus: tangente verticale au départ, pointe nette en bas.
  return SHOULDER * Math.cos(((sy - 0.15) / 0.85) * (Math.PI / 2));
}

function inShield(x, y) {
  return Math.abs(x) <= halfWidth(y);
}

/** Distance d'un point au segment [a, b], pour tracer la coche. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Coche de validation, creusée dans le bouclier. */
function inCheck(x, y) {
  const width = 0.13;
  return (
    distanceToSegment(x, y, -0.30, -0.02, -0.08, 0.22) < width ||
    distanceToSegment(x, y, -0.08, 0.22, 0.32, -0.28) < width
  );
}

function roundedSquare(x, y) {
  const r = CORNER;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax <= 1 - r || ay <= 1 - r) return true;
  return ((ax - (1 - r)) / r) ** 2 + ((ay - (1 - r)) / r) ** 2 <= 1;
}

/** Anticrénelage par échantillonnage: 3x3 points par pixel. */
function sample(px, py) {
  const samples = 3;
  let bg = 0;
  let fg = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = ((px + (sx + 0.5) / samples) / SIZE) * 2 - 1;
      const y = ((py + (sy + 0.5) / samples) / SIZE) * 2 - 1;
      if (!roundedSquare(x, y)) continue;
      bg++;
      // Le bouclier occupe 62 % de la hauteur, légèrement remonté.
      const shieldX = x / 0.62;
      const shieldY = (y + 0.02) / 0.62;
      if (inShield(shieldX, shieldY) && !inCheck(shieldX, shieldY)) fg++;
    }
  }
  const total = samples * samples;
  return { alpha: bg / total, ink: fg / total };
}

function buildPixels() {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  let offset = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // filtre PNG "None"
    for (let x = 0; x < SIZE; x++) {
      const { alpha, ink } = sample(x, y);
      for (let c = 0; c < 3; c++) {
        raw[offset++] = Math.round(BACKGROUND[c] * (1 - ink) + FOREGROUND[c] * ink);
      }
      raw[offset++] = Math.round(alpha * 255);
    }
  }
  return raw;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // profondeur
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(buildPixels(), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.join(ROOT, 'build', 'icon.png');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, png);
console.log(`build/icon.png ecrit (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} Ko)`);
