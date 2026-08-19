/**
 * Vocabulaire du classement des réponses de courtiers.
 *
 * Pourquoi un lexique plutôt que des phrases toutes faites: chaque courtier
 * écrit à sa façon. « Your profile is gone from our site », « Your listing has
 * been taken down », « Nous avons procédé à l'effacement » disent la même
 * chose sans partager un seul mot. Chercher des phrases entières échoue sur
 * tout ce qui n'a pas été prévu; chercher des notions et leur cooccurrence
 * résiste à la reformulation.
 *
 * Chaque famille est une liste de motifs élémentaires. Le classificateur
 * combine ensuite les familles présentes: un verbe d'effacement accompagné d'un
 * nom de donnée vaut une suppression, une négation d'existence accompagnée d'un
 * nom de donnée vaut une absence de dossier.
 */

/** Compilé une fois: ces expressions sont évaluées sur chaque message reçu. */
const compile = (parts: string[]): RegExp => new RegExp(`(${parts.join('|')})`, 'i');

// --- notions liées à la donnée elle-même -----------------------------------

/** « vos données », « your record », « la fiche », « votre profil ». */
export const DATA_NOUN = compile([
  'donn[ée]es?', 'informations?', 'fiche', 'profil', 'dossier', 'coordonn[ée]es',
  'inscription', 'annonce',
  'data', 'information', 'records?', 'profiles?', 'listings?', 'entry', 'entries',
  'details', 'account', 'personal\\s+info(rmation)?',
]);

/** Ce qui désigne la personne: sans cela, une phrase générique se déclenche. */
export const ABOUT_YOU = compile([
  'vous\\s+concernant', 'votre', 'vos', 'te\\s+concernant',
  'your', 'you', 'about\\s+you', 'associated\\s+with\\s+(you|your)',
  'matching', 'provided', 'requested', 'submitted',
]);

// --- notions d'action ------------------------------------------------------

/** Verbes d'effacement, tous temps et voix confondus. */
export const DELETE_VERB = compile([
  'supprim[ée]?e?s?', 'effac[ée]?e?s?', 'retir[ée]?e?s?', 'radi[ée]?e?s?',
  'd[ée]sinscrit', 'anonymis[ée]?e?s?', 'purg[ée]?e?s?', 'd[ée]r[ée]f[ée]renc[ée]?e?s?',
  'delet(e|ed|ion)', 'remov(e|ed|al)', 'eras(e|ed|ure)', 'purg(e|ed)',
  'suppress(ed|ion)', 'scrubb?ed', 'wiped', 'expunged', 'taken\\s+down',
  'opted?\\s*[\\s-]?out', 'de-?listed', 'unlisted',
]);

/** Marque un fait accompli: « a été », « has been », « we have », « done ». */
export const PAST_DONE = compile([
  'a\\s+[ée]t[ée]', 'ont\\s+[ée]t[ée]', 'avons', 'est\\s+d[ée]sormais', 'sont\\s+d[ée]sormais',
  'bien\\s+[ée]t[ée]', 'proc[ée]d[ée]\\s+[àa]', 'suite\\s+[àa]\\s+votre\\s+demande',
  'has\\s+been', 'have\\s+been', 'was', 'were', 'we\\s+have', 'is\\s+now', 'are\\s+now',
  'successfully', 'completed?', 'done', 'as\\s+of\\s+(today|now)', 'permanently',
  'this\\s+is\\s+to\\s+confirm', 'confirming', 'confirmation\\s+(that|of)',
]);

/** Disparition constatée: « ne figure plus », « no longer appears », « is gone ». */
export const NO_LONGER_PRESENT = compile([
  'ne\\s+(figure|appara[îi]t|s.affiche)\\w*\\s+plus', 'n.appara[îi]t\\s+plus',
  'plus\\s+(visible|pr[ée]sente?|r[ée]f[ée]renc[ée]e?|accessible)',
  'no\\s+longer\\s+(appears?|available|listed|displayed?|visible|searchable|present)',
  'is\\s+gone', 'are\\s+gone', 'gone\\s+from', 'will\\s+not\\s+(show|appear)',
  'won.t\\s+(show|appear)', 'has\\s+been\\s+taken\\s+down', 'off\\s+(our|the)\\s+site',
]);

/** Absence de dossier: « aucune donnée », « nothing on file », « came up empty ». */
export const NOT_FOUND = compile([
  'aucune?\\s+(donn[ée]e|information|fiche|correspondance|r[ée]sultat|trace)',
  'pas\\s+de\\s+(donn[ée]e|information|fiche|correspondance|r[ée]sultat)',
  'rien\\s+(ne\\s+remonte|[àa]\\s+signaler|trouv[ée])', 'ne\\s+(d[ée]tenons|poss[ée]dons|disposons|trouvons)',
  'n.avons\\s+(trouv[ée]|identifi[ée])\\s+aucun',
  'no\\s+(matching\\s+)?(records?|data|information|results?|matches?|entry|entries|profile)',
  'not\\s+(found|listed|identified|present|in\\s+our)', 'nothing\\s+(on\\s+file|found|to\\s+report)',
  'came\\s+up\\s+empty', 'unable\\s+to\\s+locate', 'could\\s+not\\s+(find|locate)',
  'do\\s+not\\s+have\\s+(any|a)\\b', 'don.t\\s+have\\s+(any|a)\\b', 'never\\s+(had|existed)',
  'no\\s+such\\s+(record|profile|listing)',
]);

// --- notions d'action attendue de l'utilisateur ----------------------------

/** Un geste est demandé: cliquer, suivre, valider. */
export const CLICK_ACTION = compile([
  'cliqu(ez|er)', 'suiv(ez|re)\\s+(ce|le)\\s+lien', 'valid(ez|er)', 'confirm(ez|er)',
  'activ(ez|er)', 'v[ée]rifi(ez|er)\\s+votre',
  'click', 'follow\\s+(this|the)\\s+link', 'confirm', 'verify', 'validate', 'activate',
  'tap\\s+(here|the)',
]);

/** Le geste porte sur une confirmation: lien, jeton, adresse à vérifier. */
export const CONFIRM_OBJECT = compile([
  'lien\\s+de\\s+(confirmation|validation|v[ée]rification)', 'votre\\s+demande', 'votre\\s+adresse',
  'confirmation\\s+link', 'verification\\s+(link|email|code)', 'your\\s+(request|email|address|identity)',
  'to\\s+(confirm|verify|complete|finalize|finish|proceed)', 'this\\s+link', 'the\\s+link\\s+below',
  'within\\s+\\d+\\s*(h|hours?|heures?|days?|jours?)', 'expires?', 'expire',
]);

/** Un document d'identité est réclamé. */
export const ID_DOC = compile([
  'pi[èe]ce\\s+d.identit[ée]', 'carte\\s+d.identit[ée]', 'justificatif\\s+d.identit[ée]',
  'passeport', 'permis\\s+de\\s+conduire', 'document\\s+officiel',
  'government[\\s-]?issued', 'photo\\s+id\\b', 'identification\\s+document', 'official\\s+document',
  'passport', 'driver.?s\\s+licen[cs]e', 'id\\s+card', 'proof\\s+of\\s+(identity|address)',
  'last\\s+(four|4)\\s+(digits)?\\s*(of\\s+your\\s+)?(ssn|social)',
  'selfie', 'scan\\s+of\\s+(an?|your)', 'copie\\s+de\\s+votre',
]);

/** Il faut fournir ou téléverser quelque chose. */
export const PROVIDE_VERB = compile([
  'joindre', 'fournir', 'transmettre', 'envoyer', 'nous\\s+adresser', 'merci\\s+de\\s+nous',
  'attach', 'upload', 'provide', 'send\\s+us', 'submit\\s+a', 'share\\s+a', 'include\\s+a',
]);

/** Passage obligé par un formulaire ou un portail. */
export const PORTAL = compile([
  'formulaire', 'portail', 'page\\s+d[ée]di[ée]e', 'espace\\s+d[ée]di[ée]', 'notre\\s+site',
  'form\\b', 'portal', 'web\\s*page', 'privacy\\s+cent(er|re)', 'request\\s+cent(er|re)',
  'online\\s+request', 'dsar', 'self[\\s-]?service',
]);

/** L'email n'est pas la bonne voie. */
export const NOT_BY_EMAIL = compile([
  'ne\\s+traitons\\s+pas.{0,30}(e-?mail|courriel)', 'n.est\\s+pas\\s+surveill[ée]e?',
  'cette\\s+bo[îi]te\\s+n', 'ne\\s+peut\\s+pas\\s+[êe]tre\\s+trait[ée]e?\\s+par\\s+(e-?mail|courriel)',
  '(do|does)\\s+not\\s+(accept|process|handle|monitor)', 'is\\s+not\\s+monitored',
  'unmonitored', 'cannot\\s+be\\s+processed\\s+(via|by)\\s+e-?mail',
  'only\\s+(handled|accepted|processed)\\s+(through|via|at)', 'must\\s+be\\s+(filed|submitted)',
]);

// --- notions de refus et d'attente -----------------------------------------

/** Refus explicite ou exception légale invoquée. */
export const REFUSAL = compile([
  'refus\\w*', 'rejet\\w*', 'ne\\s+pouvons\\s+pas\\s+(donner\\s+suite|acc[ée]der|proc[ée]der)',
  'ne\\s+donnerons\\s+pas\\s+suite', 'obligation\\s+l[ée]gale', 'motif\\s+l[ée]gal',
  'int[ée]r[êe]t\\s+l[ée]gitime', 'conservons\\s+(ces|vos|les)\\s+donn[ée]es',
  // « nous sommes tenus de les conserver »: un pronom peut s'intercaler.
  'sommes\\s+tenus\\s+de\\s+(les\\s+|la\\s+|le\\s+)?conserver', 'devons\\s+(les\\s+)?conserver',
  'denied', 'rejected', 'declined', 'refuse', 'cannot\\s+(be\\s+)?(honor|comply|delete|remove)',
  'unable\\s+to\\s+(comply|honor|fulfill)', 'not\\s+required\\s+to', 'are\\s+exempt', 'exemption',
  'legally\\s+(required|obligated)\\s+to\\s+(retain|keep)', 'legitimate\\s+interest',
  'fair\\s+credit\\s+reporting\\s+act', '\\bfcra\\b', 'consumer\\s+reporting\\s+agenc',
  'we\\s+retain', 'retention\\s+(period|obligation)',
]);

/** Accusé de réception, traitement annoncé. */
export const ACK = compile([
  'bien\\s+re[çc]u', 'avons\\s+re[çc]u', 'a\\s+bien\\s+[ée]t[ée]\\s+enregistr[ée]e?',
  'en\\s+cours\\s+de\\s+traitement', 'sera\\s+trait[ée]e?', 'reviendrons\\s+vers\\s+vous',
  'sous\\s+r[ée]f[ée]rence', 'num[ée]ro\\s+de\\s+(dossier|ticket)', 'd[ée]lai\\s+de\\s+\\d+',
  'received\\s+your', 'we\\s+(have|.ve)\\s+received', 'is\\s+being\\s+(processed|reviewed|handled)',
  'will\\s+(be\\s+)?(process|review|respond|get\\s+back|look)', 'someone\\s+will',
  'ticket\\s*#?\\s*\\w', 'case\\s*(number|#)', 'reference\\s*(number|#|:)',
  'please\\s+allow\\s+(up\\s+to\\s+)?\\d+', 'business\\s+days', 'thank\\s+you\\s+for\\s+(your|contacting|reaching)',
  'opened', 'logged',
]);

/** Rebond technique du serveur de messagerie. */
export const BOUNCE = compile([
  'mail\\s+delivery\\s+(failed|subsystem)', 'undeliverable', 'delivery\\s+status\\s+notification',
  'address\\s+not\\s+found', 'recipient\\s+(address\\s+)?rejected', 'user\\s+unknown',
  'mailbox\\s+(unavailable|full|does\\s+not\\s+exist)', 'no\\s+such\\s+user',
  'adresse\\s+introuvable', 'destinataire\\s+inconnu', 'impossible\\s+de\\s+remettre',
  '55[0-9]\\s+5\\.[0-9]\\.[0-9]', 'permanent\\s+(failure|error)',
]);

/** Réponse automatique d'absence: à ignorer, ce n'est pas un traitement. */
export const OUT_OF_OFFICE = compile([
  'absen(t|ce)\\s+du\\s+bureau', 'message\\s+automatique\\s+d.absence', 'de\\s+retour\\s+le',
  'out\\s+of\\s+(the\\s+)?office', 'on\\s+(annual\\s+)?leave', 'auto[\\s-]?reply',
  'currently\\s+away', 'vacation\\s+(reply|responder)',
]);

/** Négations qui inversent le sens d'un verbe d'effacement. */
export const NEGATED_DELETE = compile([
  // « ne seront pas supprimées » comme « ne peuvent pas être effacées »:
  // l'auxiliaire est facultatif en français.
  'ne\\s+(sera|seront|peut|peuvent|pouvons|pourrons)\\s+pas\\s+([êe]tre\\s+)?(supprim|effac|retir|anonymis)',
  'ne\\s+(supprimerons|effacerons|retirerons)\\s+pas',
  '(will|can|cannot|can.t|won.t|do)\\s*(not)?\\s*(be\\s+)?(delete|remove|eras)\\w*\\s*(your|the|any)?',
  'not\\s+be\\s+(deleted|removed|erased)', 'do\\s+not\\s+(delete|remove)',
]);

/**
 * Le verbe d'effacement désigne notre demande, pas l'action du courtier.
 *
 * « Your request to delete your information has been received » contient un
 * verbe d'effacement et un passé accompli, mais ne dit rien de plus que
 * « nous avons reçu ». Sans cette distinction, tout accusé de réception
 * passerait pour une suppression effectuée.
 */
export const REQUEST_NAMING = compile([
  '(demande|requ[êe]te)\\s+(de|d.)\\s*(suppression|effacement|retrait|radiation)',
  'request\\s+(to|for)\\s+(delet|remov|eras|suppress)',
  'deletion\\s+request', 'removal\\s+request', 'erasure\\s+request', 'opt[\\s-]?out\\s+request',
]);

/**
 * Prise en charge annoncée, sans numéro de ticket ni geste attendu.
 *
 * « Your request has been submitted successfully and will be actioned, there
 * is no further action required from you »: pas d'accusé de réception au sens
 * habituel, aucune référence de dossier, et pourtant la demande avance. Ce cas
 * ressortait « indéterminé » et laissait la demande sans suite. Relevé sur une
 * réponse réelle de Choreograph, le 19 août 2026.
 */
export const PRISE_EN_CHARGE = compile([
  'will\\s+be\\s+(actioned|processed|handled|reviewed|completed)',
  'no\\s+further\\s+action\\s+(is\\s+)?required',
  'has\\s+been\\s+(submitted|received|logged|registered)\\s+successfully',
  'submitted\\s+successfully',
  'sera\\s+trait[ée]{1,2}',
  "aucune\\s+action\\s+(suppl[ée]mentaire\\s+)?n'est\\s+requise",
  'votre\\s+demande\\s+a\\s+bien\\s+[ée]t[ée]\\s+(enregistr|re[çc]|transmis)',
]);
