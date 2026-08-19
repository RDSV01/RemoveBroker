import zlib from 'node:zlib';

/**
 * Lecture d'une archive tar.gz, sans dépendance.
 *
 * Le dépôt datenanfragen publie une fiche par fichier, plus de mille au total.
 * Les récupérer un par un ferait mille requêtes; l'archive n'en demande qu'une.
 * Le format tar est assez simple pour être lu ici: des blocs de 512 octets, un
 * en-tête donnant le nom et la taille, puis le contenu aligné sur 512.
 *
 * Ce code ne tourne qu'à la construction du catalogue, jamais chez
 * l'utilisateur.
 */
export function extractTarGz(buffer, keep = () => true) {
  const tar = zlib.gunzipSync(buffer);
  const files = new Map();
  const BLOC = 512;

  let offset = 0;
  while (offset + BLOC <= tar.length) {
    const entete = tar.subarray(offset, offset + BLOC);

    // Deux blocs nuls consécutifs marquent la fin de l'archive.
    if (entete.every((octet) => octet === 0)) break;

    const nom = entete.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const tailleOctale = entete.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const taille = parseInt(tailleOctale, 8) || 0;
    // '0' et '\0' désignent un fichier ordinaire; le reste est ignoré.
    const type = String.fromCharCode(entete[156]);

    offset += BLOC;
    if ((type === '0' || type === '\0') && nom && keep(nom)) {
      files.set(nom, tar.subarray(offset, offset + taille));
    }
    // Le contenu est complété jusqu'au prochain multiple de 512.
    offset += Math.ceil(taille / BLOC) * BLOC;
  }

  return files;
}
