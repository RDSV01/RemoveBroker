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
  // Relevés sur des réponses réelles le 19 août 2026: Choreograph écrit
  // « unable to find any record », Fandom « we do not appear to have any
  // accounts », Yasni « we have no data about your name ». Aucune de ces
  // formules n'était reconnue, et les trois passaient pour des suppressions.
  'unable\\s+to\\s+find', 'not\\s+able\\s+to\\s+(find|locate|identify)',
  'do(es)?\\s+not\\s+appear\\s+to\\s+have', 'don.t\\s+appear\\s+to\\s+have',
  'have\\s+no\\s+(data|record|information)', 'we\\s+hold\\s+no\\b',
  'no\\s+record\\s+(associated|matching|found|of)', 'without\\s+a\\s+(match|record)',
  'completely\\s+unknown\\s+to\\s+us', 'unknown\\s+to\\s+us',
  // Allemand et espagnol: le classement ne couvrait que le français et l'anglais.
  'keine\\s+(daten|informationen|eintr[äa]ge?)', 'nicht\\s+gefunden',
  'no\\s+(hemos\\s+encontrado|tenemos\\s+(datos|registros?))', 'ning[úu]n\\s+(dato|registro)',
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
  'bonne\\s+r[ée]ception',
  'en\\s+cours\\s+de\\s+traitement', 'sera\\s+trait[ée]e?', 'reviendrons\\s+vers\\s+vous',
  'sous\\s+r[ée]f[ée]rence', 'num[ée]ro\\s+de\\s+(dossier|ticket)', 'd[ée]lai\\s+de\\s+\\d+',
  'received\\s+your', 'we\\s+(have|.ve)\\s+received', 'is\\s+being\\s+(processed|reviewed|handled)',
  'will\\s+(be\\s+)?(process|review|respond|get\\s+back|look)', 'someone\\s+will',
  'ticket\\s*#?\\s*\\w', 'case\\s*(number|#)', 'reference\\s*(number|#|:)',
  'please\\s+allow\\s+(up\\s+to\\s+)?\\d+', 'business\\s+days', 'thank\\s+you\\s+for\\s+(your|contacting|reaching)',
  'opened', 'logged',
  // Marriott ouvre « un nouveau billet de demande » sans employer aucune des
  // formules ci-dessus: la réponse ressortait indéterminée alors qu'elle dit
  // exactement qu'une demande est en cours de traitement.
  'ouvert\\s+un\\s+(nouveau\\s+)?(billet|ticket|dossier)', 'billet\\s+de\\s+demande',
  'demande\\s+d.identit[ée]\\s+est', 'votre\\s+(nouvelle\\s+)?demande\\s+(est|porte\\s+le)',
]);

/** Rebond technique du serveur de messagerie. */
export const BOUNCE = compile([
  'mail\\s+delivery\\s+(failed|subsystem)', 'undeliverable', 'delivery\\s+status\\s+notification',
  'address\\s+not\\s+found', 'recipient\\s+(address\\s+)?rejected', 'user\\s+unknown',
  'mailbox\\s+(unavailable|full|does\\s+not\\s+exist)', 'no\\s+such\\s+user',
  'adresse\\s+introuvable', 'destinataire\\s+inconnu', 'impossible\\s+de\\s+remettre',
  '55[0-9]\\s+5\\.[0-9]\\.[0-9]', 'permanent\\s+(failure|error)',
]);

/**
 * Réponse automatique d'absence: à ignorer, ce n'est pas un traitement.
 *
 * Les formules manquantes coûtaient cher: « Je suis absent jusqu'au 30 août »
 * n'était pas reconnu, la réponse passait par le reste du classement et une
 * demande a été marquée « supprimée » sur la foi d'un répondeur de vacances.
 */
export const OUT_OF_OFFICE = compile([
  'absen(t|ce)\\s+du\\s+bureau', 'message\\s+automatique\\s+d.absence', 'de\\s+retour\\s+le',
  'out\\s+of\\s+(the\\s+)?office', 'on\\s+(annual\\s+)?leave', 'auto[\\s-]?reply',
  'currently\\s+away', 'vacation\\s+(reply|responder)',
  // Français
  'suis\\s+(actuellement\\s+)?absent', 'sommes\\s+(actuellement\\s+)?absents?',
  'en\\s+cong[ée]s?', 'en\\s+mon\\s+absence', 'de\\s+retour\\s+(le|[àa]\\s+partir)',
  'ferm[ée]\\s+pour\\s+(les\\s+)?cong[ée]s', 'r[ée]ponse\\s+automatique',
  'je\\s+reviendrai\\s+vers\\s+vous',
  // Allemand
  'abwesenheit', 'nicht\\s+im\\s+b[üu]ro', 'im\\s+urlaub', 'urlaubsvertretung',
  'ab\\s+dem\\s+\\d+\\.\\s*\\w+\\s+wieder',
  // Espagnol et italien
  'fuera\\s+de\\s+la\\s+oficina', 'de\\s+vacaciones', 'respuesta\\s+autom[áa]tica',
  'fuori\\s+sede', 'in\\s+ferie', 'risposta\\s+automatica',
]);

/**
 * L'adresse écrite n'existe plus et le courtier en indique une autre.
 *
 * Trois réponses réelles sur quarante disaient exactement cela: « Cette adresse
 * n'est plus en service », « CUENTA DE PRIVACIDAD INACTIVA », « Cette adresse
 * mail n'est plus active, utilisez notre formulaire ». Aucune n'était reconnue:
 * la demande restait « indéterminée », donc sans suite, alors que la marche à
 * suivre était écrite noir sur blanc dans le message.
 */
export const ADDRESS_RETIRED = compile([
  // Volontairement limité aux constats explicites. Une simple consigne de
  // réacheminement ne suffit pas: « please direct your request to » figure dans
  // la réponse de HireRight, qui commence pourtant par « vous avez écrit au bon
  // endroit ». C'est la mort de l'adresse qui doit être affirmée, pas le fait
  // qu'une autre existe.
  'adresse\\s+(mail\\s+|e-?mail\\s+|de\\s+messagerie\\s+)?n.est\\s+plus\\s+(en\\s+service|active|utilis[ée]e|valide|surveill[ée]e)',
  'cette\\s+(adresse|bo[îi]te)\\s+(mail\\s+)?n.est\\s+plus',
  'n.est\\s+plus\\s+(en\\s+service|op[ée]rationnelle)',
  'this\\s+(e-?mail\\s+)?(address|account|inbox|mailbox)\\s+is\\s+no\\s+longer',
  '(address|inbox|mailbox)\\s+(is\\s+)?no\\s+longer\\s+(in\\s+use|active|monitored)',
  'has\\s+been\\s+(retired|decommissioned)',
  'cuenta\\s+de\\s+privacidad\\s+inactiva', 'ya\\s+no\\s+se\\s+encuentra\\s+operativa',
  'diese\\s+adresse\\s+wird\\s+nicht\\s+mehr',
]);

/**
 * Le verbe d'effacement décrit une marche à suivre, pas un acte accompli.
 *
 * « Pour supprimer vos données vous avez 2 possibilités », « Vous pouvez gérer
 * vos informations personnelles », « Sur quel site souhaitez-vous que vos
 * données soient effacées ? »: trois réponses réelles, trois demandes marquées
 * « supprimée » à tort. Le verbe est bien là, l'acte non.
 */
export const INSTRUCTION = compile([
  'pour\\s+(supprimer|effacer|retirer|g[ée]rer)', 'vous\\s+(pouvez|pourrez|devez|avez)\\s+\\w+',
  'il\\s+(faudrait|faut)\\s+que\\s+vous', 'veuillez\\s+', 'merci\\s+de\\s+',
  'souhaitez[\\s-]?vous', 'quel(le)?s?\\s+\\w+\\s+souhaitez',
  'you\\s+(can|may|should|will\\s+need\\s+to|must)\\b', 'in\\s+order\\s+to\\s+(delete|remove|erase)',
  'to\\s+(delete|remove|erase)\\s+your\\s+\\w+,?\\s+(please|you)',
  'if\\s+you\\s+(would\\s+like|wish|want)\\s+to',
]);

/** Négations qui inversent le sens d'un verbe d'effacement. */
export const NEGATED_DELETE = compile([
  // « ne seront pas supprimées » comme « ne peuvent pas être effacées »:
  // l'auxiliaire est facultatif en français.
  'ne\\s+(sera|seront|peut|peuvent|pouvons|pourrons)\\s+pas\\s+([êe]tre\\s+)?(supprim|effac|retir|anonymis)',
  'ne\\s+(supprimerons|effacerons|retirerons)\\s+pas',
  // La négation est obligatoire. Écrite facultative, cette expression
  // reconnaissait aussi « we will delete your data », c'est-à-dire l'exact
  // contraire: un accord de suppression comptait comme un refus.
  '(will|can|do|does)\\s+not\\s+(be\\s+)?(delete|remove|eras)\\w*',
  '(cannot|can.t|won.t)\\s+(be\\s+)?(delete|remove|eras)\\w*',
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
  // Le courtier reformule notre demande avant d'y répondre: « vous demandez ce
  // qui suit: Supprimer mes données », « vous souhaitez demander la suppression
  // de vos données ». Le verbe d'effacement est le nôtre, pas le sien.
  'vous\\s+(demandez|souhaitez|nous\\s+demandez)', 'demander\\s+(la\\s+)?(suppression|effacement)',
  'nous\\s+comprenons\\s+(que|d.apr[èe]s)', 'je\\s+comprends\\s+que',
  'we\\s+understand\\s+(that\\s+)?you', 'you\\s+(have\\s+)?requested\\s+(that|the|to)',
  'your\\s+request\\s+(type|id)\\s*:',
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
