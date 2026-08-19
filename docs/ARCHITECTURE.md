# Architecture

Ce document explique les choix structurants et leurs raisons. Il s'adresse à
quelqu'un qui veut modifier le projet, pas seulement l'utiliser.

## Vue d'ensemble

```
                    ┌──────────────────────────────┐
                    │  Interface React (navigateur │
                    │  ou fenêtre Electron)        │
                    └──────────────┬───────────────┘
                                   │ HTTP + flux d'événements
                    ┌──────────────┴───────────────┐
                    │  Serveur Fastify, 127.0.0.1  │
                    ├──────────────────────────────┤
                    │  Moteur: file, planificateur │
                    │  Emails: envoi, relève,      │
                    │          classement          │
                    │  Web: recettes Playwright    │
                    │  Chiffrement: clé, AES-GCM   │
                    └──────┬────────────────┬──────┘
                           │                │
                  ┌────────┴──────┐  ┌──────┴─────────┐
                  │ SQLite chiffré│  │ catalog.json   │
                  └───────────────┘  └────────────────┘
```

Un seul processus. Pas de service séparé, pas de file de messages externe, pas
de base à installer: une application locale doit démarrer d'un double-clic.

## Choix techniques

### TypeScript partout

Le serveur et l'interface partagent les mêmes types métier. Le format d'un
courtier ou d'une demande est défini une fois, dans `apps/server/src/types.ts`,
et l'interface s'aligne dessus. Une évolution de schéma casse la compilation
plutôt que l'exécution.

### SQLite via better-sqlite3

Un fichier, aucun service à administrer, des transactions synchrones. Le pilote
synchrone est un avantage ici: la charge est d'une seule personne, et le code
d'un moteur d'envoi devient beaucoup plus simple sans `await` sur chaque
lecture.

Les migrations sont numérotées dans `db/index.ts` et appliquées au
démarrage. Une version antérieure ne rouvre jamais une base plus récente.

### Fastify

Rapide, sans intermédiaire, avec une validation par schéma. L'API n'est pas
publique: elle sert une seule interface, sur la boucle locale.

### React avec TanStack Query

L'interface est essentiellement de la lecture d'état distant. Query gère le
cache, la revalidation et les états de chargement; il ne reste presque aucun
état local à synchroniser à la main.

Le flux d'événements (`GET /api/events`, Server-Sent Events) pousse les
changements du moteur vers l'interface: un envoi effectué apparaît sans que la
page interroge en boucle.

### Electron pour le bureau

Uniquement une enveloppe: elle démarre le serveur dans son processus, ouvre une
fenêtre dessus, et reste dans la zone de notification pour que les envois
programmés continuent. Elle apporte deux choses qu'un onglet de navigateur ne
peut pas donner: l'accès au trousseau du système via `safeStorage`, et
l'exécution en arrière-plan.

Electron 35 ou plus récent est nécessaire: better-sqlite3 13 exige Node 22, et
les versions antérieures d'Electron embarquent Node 20. Avec l'une d'elles, la
bibliothèque se charge puis plante à la première requête.

## Le catalogue

### Construction

`scripts/build-catalog.mjs` fusionne cinq sources:

| Source | Apport | Limite |
| --- | --- | --- |
| Liste des fournisseurs TCF (IAB Europe) | Les societes qui traitent des donnees europeennes a des fins publicitaires, avec leur politique | Publicite uniquement, pas d adresse de contact |
| Registre CPPA et annuaire Optery | Identifient les acteurs mondiaux soumis au RGPD | Orientes Etats-Unis: les entrees strictement americaines sont ecartees |
| Liste eraser | Large couverture marketing, toujours une adresse email | Peu de métadonnées |
| Base Datenanfragen (CC0) | Adresses de délégués à la protection des données, vérifiées à la main, sociétés soumises au RGPD | Vocabulaire de catégories large: filtrage nécessaire |
| `catalog/overrides/` | Europe, France, corrections | Maintenu à la main |

La fusion se fait par domaine enregistrable. Quand deux sources se contredisent,
des règles explicites tranchent: le nom commercial d'Optery l'emporte sur la
raison sociale du registre, une adresse dédiée à la vie privée l'emporte sur une
adresse générique, une catégorie précise l'emporte sur `other`.

Le résultat, `catalog/catalog.json`, est un fichier compilé: il ne se modifie
pas à la main.

### Enrichissement

`scripts/enrich-catalog.mjs` lit la politique de confidentialité des courtiers
sans adresse connue et y cherche un contact de délégué à la protection des
données. Il tourne en intégration continue, jamais chez l'utilisateur: cette
information est identique pour tout le monde, personne n'a besoin d'émettre des
centaines de requêtes depuis son ordinateur pour la retrouver.

Le résultat est mis en cache dans `catalog/enrichment.json`, résultats négatifs
compris, pour ne pas revisiter les mêmes sites chaque semaine.

### Distribution

Un workflow reconstruit le catalogue chaque semaine et le committe. Les
installations le téléchargent, vérifient l'empreinte SHA256 publiée dans
`catalog/index.json`, et n'appliquent la mise à jour qu'en cas de
correspondance. Coût d'infrastructure: zéro.

### Pertinence géographique

Chaque entrée porte un indicateur `euRelevant`, vrai si la société est
européenne, si elle figure parmi les grands acteurs transatlantiques, ou si son
activité est transfrontalière par nature (marketing, prospection B2B, scoring de
solvabilité, santé).

Cet indicateur pilote l'ordre des demandes: pour un résident français, écrire
d'abord aux régies publicitaires européennes donne des suppressions réelles,
alors qu'écrire aux quatre cents annuaires de dossiers judiciaires américains
produit surtout des réponses « aucune donnée vous concernant ». La logique est
dans `relevanceScore()`, `apps/server/src/engine/campaign.ts`.

## Le moteur

### File d'attente

`engine/queue.ts` maintient une file persistante en base. Chaque tâche connaît
son horaire d'exécution, son nombre de tentatives et sa dernière erreur.
L'application peut être fermée à tout moment: rien n'est perdu.

La temporisation par défaut, 120 emails par jour et deux envois simultanés,
tient à une contrainte externe: Gmail suspend un compte gratuit qui dépasse
environ 500 messages quotidiens. Mieux vaut une campagne étalée sur une semaine
qu'une boîte email bloquée.

### Planificateur

`engine/scheduler.ts` déclenche les tâches périodiques:

| Tâche | Fréquence |
| --- | --- |
| Relève de la boîte email | 10 minutes |
| Relance des demandes sans réponse | quotidien, seuil à 30 jours |
| Signalement du délai légal dépassé | quotidien, seuil à 45 jours |
| Recherche de nouveaux courtiers | tous les 14 jours |

### Classement des réponses

`mail/classifier.ts` range chaque message reçu dans une catégorie: confirmation,
refus, demande de vérification, accusé de réception, rebond. La méthode est un
faisceau de règles textuelles bilingues, pas un modèle statistique: le
comportement doit être lisible, testable et identique d'une installation à
l'autre. Les cas non classés remontent à l'utilisateur plutôt que d'être
devinés.

### Ouverture des liens de confirmation

`web/confirm.ts` applique trois conditions cumulatives avant d'ouvrir un lien:
correspondance avec une demande en cours, domaine appartenant au courtier ou à
l'expéditeur, protocole `https`. C'est la partie la plus sensible du projet, et
la plus testée.

### Recherche du contact quand il manque

`web/discover.ts` ouvre la politique de confidentialité du courtier avec le
navigateur local et en extrait une adresse ou un lien vers son portail de
demande. Cette étape existe parce que le robot du catalogue, qui s'annonce
honnêtement, est refusé par une bonne partie des sites: ils répondent
normalement à un navigateur. Le résultat est mémorisé dans la table
`broker_contact` pour ne pas recommencer à chaque campagne.

Les adresses écrites en toutes lettres pour échapper aux robots, du type
`dpo [at] exemple [dot] com`, sont reconnues: c'est la forme employée par The
Trade Desk et par le registre du procureur général de Californie.

### Automatisation des formulaires

`web/runner.ts` interprète les recettes déclaratives de `catalog/recipes/`.
Aucun code spécifique à un site n'est compilé dans l'application: ajouter un
site consiste à écrire du YAML, ce qu'un contributeur non développeur peut
faire.

 complète les recettes par un appariement générique entre les
champs d'une page et ceux du profil, sans recette écrite d'avance. Il refuse de
remplir quoi que ce soit tant qu'aucun conteneur ne ressemble à un formulaire
d'exercice de droits: une politique de confidentialité contient une barre de
recherche et une inscription à la lettre d'information, et les remplir en
annonçant un succès serait un mensonge. La soumission automatique, en option,
rend la main dès qu'un captcha apparaît.

`web/assist.ts` complète les recettes par un appariement générique entre les
champs d'une page et ceux du profil, sans recette écrite d'avance. Il refuse de
remplir quoi que ce soit tant qu'aucun conteneur ne ressemble à un formulaire
d'exercice de droits: une politique de confidentialité contient une barre de
recherche et une inscription à la lettre d'information, et les remplir en
annonçant un succès serait un mensonge. La soumission automatique, en option,
rend la main dès qu'un captcha apparaît.

Playwright n'est pas embarqué dans l'installateur: 300 Mo pour une
fonctionnalité qui ne concerne qu'une minorité de courtiers. Il se télécharge à
la demande.

## Chiffrement

`crypto/keyring.ts` gère une clé maîtresse de 32 octets, elle-même protégée
selon le mode choisi: scellée par le trousseau du système, dérivée d'une phrase
secrète par scrypt, ou stockée en clair.

`crypto/cipher.ts` chiffre les champs sensibles en AES-256-GCM, avec un nonce par
enregistrement. Les métadonnées structurelles restent en clair: chiffrer un
identifiant de courtier interdirait toute requête SQL sans rien protéger de
substantiel.

Le raisonnement complet est dans [VIE-PRIVEE.md](VIE-PRIVEE.md).

## Modèles d'emails

`mail/templates.ts` produit le texte des demandes. Trois régimes juridiques
(RGPD, UK GDPR), deux langues, et une variante par type de demande:
première demande, relance, mise en demeure.

Le ton est délibérément factuel et cite l'article applicable ainsi que le délai
de réponse. Un destinataire doit pouvoir traiter la demande sans se demander si
elle est sérieuse.

Le même module génère la plainte à l'autorité compétente, déduite du pays de
résidence.

## Ce qui a été écarté

- **Une base de données serveur.** Rien ne le justifie pour un utilisateur
  unique, et cela ajouterait une installation.
- **Un service hébergé.** Le projet perdrait son intérêt: il faudrait confier
  son identité à un tiers, ce que fait déjà Incogni.
- **Un modèle de langage pour classer les réponses.** Soit il tourne à distance,
  et les emails sortent de la machine; soit il tourne en local, et l'application
  pèse plusieurs gigaoctets pour un gain modeste sur des messages très
  stéréotypés.
- **La résolution automatique de captcha par défaut.** Techniquement possible
  via un service tiers payant, mais cela reviendrait à envoyer des captures de
  pages à un inconnu. Reste possible, sur activation explicite.
