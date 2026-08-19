# Vie privée et sécurité

Un outil qui centralise votre nom, votre adresse, votre téléphone, votre date de
naissance et les identifiants de votre boîte email constitue une cible de choix.
Ce document décrit ce qui est fait pour que cette concentration ne se retourne
pas contre vous, et ce qui reste hors de portée du logiciel.

## Ce qui sort de votre ordinateur

Trois flux, tous nécessaires au fonctionnement:

1. **Les emails que vous envoyez aux courtiers**, via le serveur d'envoi de
   votre propre fournisseur. Le projet n'a aucun relais.
2. **La relève de votre boîte**, vers le serveur de réception de votre
   fournisseur, uniquement si vous l'activez.
3. **Le téléchargement du catalogue**, depuis `raw.githubusercontent.com`. Une
   requête `GET` sur un fichier statique, sans paramètre, sans identifiant. Vous
   pouvez la désactiver dans les réglages ou pointer vers votre propre copie.

Quand l'automatisation des formulaires est activée, un navigateur local visite
aussi les sites des courtiers concernés, comme vous le feriez à la main.

## Ce qui n'existe pas

- Aucune télémétrie, aucune statistique d'usage, aucun rapport d'erreur distant.
- Aucun compte, aucune authentification auprès d'un service du projet.
- Aucun appel au démarrage vers un serveur du projet, hors mise à jour du
  catalogue.
- Aucune police, aucun script, aucune image chargés depuis un service tiers:
  l'interface est entièrement embarquée.

Cette liste est vérifiable en quelques secondes. `grep -rn "fetch(" apps/server/src`
ne renvoie que deux appels HTTP sortants: le téléchargement du catalogue dans
`core/catalog.ts`, et l'ouverture d'un lien de confirmation dans
`web/confirm.ts`. Le reste du trafic passe par les bibliothèques SMTP et IMAP,
vers les serveurs que vous avez vous-même renseignés.

## Chiffrement au repos

Trois modes, choisis dans **Paramètres, Confidentialité**.

| Mode | Protection | Quand l'utiliser |
| --- | --- | --- |
| Trousseau du système | La clé est scellée par DPAPI (Windows), le Keychain (macOS) ou le portefeuille du bureau (Linux). Une autre session utilisateur ne peut pas la lire | Recommandé sur un poste personnel |
| Phrase secrète | La clé est dérivée par scrypt (N=2^16). Elle est demandée à chaque démarrage | Machine partagée, conteneur, disque non chiffré |
| Clé en clair | La clé est stockée en clair à côté de la base | Uniquement si le disque est déjà chiffré et que vous savez pourquoi |

Le contenu chiffré: profil, identifiants SMTP et IMAP, corps des messages
envoyés et reçus, notes des demandes. L'algorithme est AES-256-GCM, avec un
nonce distinct par enregistrement.

Le contenu non chiffré: les métadonnées structurelles, comme l'identifiant d'un
courtier, l'horodatage d'un envoi ou le statut d'une demande. Quelqu'un qui
lirait la base sans la clé saurait que vous avez écrit à Acxiom le 3 mars, sans
savoir ce que vous avez écrit ni qui vous êtes.

### Ce que le chiffrement ne protège pas

Contre un logiciel malveillant tournant sous votre session, il ne protège rien:
ce programme peut demander au trousseau de déverrouiller la clé exactement comme
l'application le fait. Le chiffrement au repos protège contre le vol du disque,
la sauvegarde qui traîne, l'accès par une autre session, pas contre une machine
compromise.

## Le mot de passe de votre messagerie

L'application n'accepte que des mots de passe d'application: un secret dédié,
révocable en un clic depuis votre fournisseur, qui ne donne accès ni à votre
compte, ni à vos autres services. Si vous cessez d'utiliser RemoveBroker,
révoquez-le et le secret stocké ne vaut plus rien.

Il est chiffré comme le reste et n'est jamais renvoyé à l'interface: les
réglages affichent des points, jamais la valeur.

## Ouverture automatique des liens de confirmation

Beaucoup de courtiers répondent par un lien à cliquer pour confirmer la demande.
L'application le fait à votre place, sous trois conditions cumulatives:

1. Le message correspond à une demande en cours chez ce courtier précis.
2. Le domaine du lien appartient au courtier ou à l'expéditeur du message.
3. Le lien est en `https`.

Un lien reçu d'un autre expéditeur, ou pointant ailleurs, n'est jamais ouvert:
il déclenche une demande d'action de votre part. Cette règle est testée dans
`apps/server/src/web/confirm.test.ts`, et c'est le premier endroit à relire si
vous auditez le projet.

Vous pouvez désactiver entièrement ce comportement.

## L'API locale

Le serveur n'écoute que sur `127.0.0.1` et n'a pas d'authentification: il part
du principe que seule la personne devant la machine peut l'atteindre. Deux
protections complètent ce choix:

- **Contrôle d'origine.** Une requête venant d'une page web ouverte dans votre
  navigateur est rejetée, ce qui empêche un site malveillant de piloter
  l'application.
- **Aucune écoute externe par défaut.** Changer `RB_HOST` expose l'API à votre
  réseau; ne le faites que derrière un tunnel.

## Journaux

Les journaux sont locaux, en mode minimal par défaut: horodatage, module,
événement. Ni adresses email, ni noms, ni contenus de messages. Le fichier est
tronqué automatiquement et effaçable depuis les réglages.

Le mode détaillé, réservé au diagnostic, enregistre davantage. Ne le laissez pas
actif en permanence.

## Effacement

**Paramètres, Mes données, Tout effacer** supprime la base, la clé, les copies
d'emails et les journaux. L'opération est immédiate et irréversible; l'interface
demande une confirmation écrite.

Exportez d'abord votre dossier de preuves si vous comptez déposer une plainte:
il disparaît avec le reste.

## Ce que voient les courtiers

Exactement ce que vous verriez en écrivant vous-même: votre adresse email, votre
nom, les éléments d'identification nécessaires pour retrouver votre fiche, et le
texte de la demande. L'application ne se fait pas passer pour un avocat, une
autorité ou une autre personne. Elle ne joint jamais de document d'identité
automatiquement.

Les messages sont envoyés depuis votre adresse: le courtier connaît déjà votre
existence, c'est la raison même de la demande.

## Signaler une faille

Voir [SECURITY.md](../SECURITY.md). N'ouvrez pas d'issue publique pour une
vulnérabilité.

## Points connus, non résolus

Par honnêteté, ce que ce modèle ne couvre pas:

- **Machine compromise**: aucune protection possible, voir plus haut.
- **Métadonnées en clair** dans la base: la liste des courtiers contactés et les
  dates restent lisibles sans la clé.
- **Fournisseur de messagerie**: il voit vos messages, comme pour tout email.
- **Fuite par les courtiers eux-mêmes**: écrire à une société lui confirme votre
  adresse email. C'est inhérent à l'exercice du droit d'effacement, quel que
  soit l'outil, y compris un service payant.
