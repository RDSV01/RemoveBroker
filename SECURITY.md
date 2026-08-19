# Politique de sécurité

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.** Utilisez l'onglet
[Security advisories](https://github.com/RDSV01/RemoveBroker/security/advisories/new)
du dépôt, qui permet un signalement privé.

Indiquez si possible:

- la version concernée,
- les étapes pour reproduire,
- l'impact que vous estimez,
- votre évaluation du délai avant publication.

Réponse sous 72 heures. Correctif visé sous 14 jours pour ce qui expose des
données d'utilisateur, sous 30 jours pour le reste. Vous serez crédité dans
l'avis publié, sauf si vous préférez l'anonymat.

Le projet n'a pas de budget: aucune récompense financière n'est proposée.

## Ce qui relève de cette politique

Le code de ce dépôt et les installateurs publiés depuis ce dépôt. Notamment:

- l'exécution de code à partir d'un email ou d'une réponse de courtier,
- l'exposition de la clé maîtresse ou des identifiants de messagerie,
- l'ouverture d'un lien de confirmation vers un domaine non autorisé,
- une requête réseau vers une destination non documentée,
- une élévation de privilèges depuis l'API locale.

## Ce qui n'en relève pas

- **L'absence d'authentification sur l'API locale.** C'est un choix documenté:
  le serveur n'écoute que sur `127.0.0.1` et suppose que seule la personne
  devant la machine peut l'atteindre. Exposer ce port sur un réseau est une
  erreur de déploiement, pas une faille du logiciel.
- **Une machine déjà compromise.** Un logiciel malveillant tournant sous votre
  session peut demander la clé au trousseau exactement comme l'application.
- **Les métadonnées non chiffrées** (identifiants de courtiers, horodatages,
  statuts), documentées dans [docs/VIE-PRIVEE.md](docs/VIE-PRIVEE.md).
- Les vulnérabilités des sites des courtiers eux-mêmes. Signalez-les à eux.

## Périmètre des tests

Testez sur votre propre installation, avec vos propres données. N'attaquez pas
les sites des courtiers depuis ce logiciel: cela ne relève pas de la recherche
de vulnérabilité sur ce projet et vous engagerait personnellement.

## Alertes connues de `npm audit`

`npm audit` signale une vulnérabilité **haute** dans `deepmerge-ts`, dépendance
transitive de `mailparser` via `html-to-text`: épuisement de la pile lors de la
fusion d'objets récursifs, donc un déni de service. Elle n'est pas corrigeable
ici: `html-to-text` verrouille la version vulnérable, et un `overrides` npm ne
s'applique pas.

Elle n'est pas exploitable dans ce projet. `html-to-text` n'utilise
`deepmerge-ts` que pour fusionner ses propres objets d'options
(`deepMergeWithOptionsComposeRules(defaultOptions, userOptions)`) et dédupliquer
des sélecteurs. Le contenu des emails reçus ne traverse jamais cette fonction:
il passe par l'analyseur HTML, pas par la fusion d'options. Les options, elles,
sont écrites en dur dans le code de RemoveBroker.

Cette note sera retirée dès que `html-to-text` acceptera `deepmerge-ts` 8.
Si vous constatez un chemin d'exploitation réel, signalez-le: l'analyse ci-dessus
serait alors fausse.

## Versions maintenues

| Version | Support |
| --- | --- |
| 1.0.x | oui |
| antérieures | non |

Le projet n'a qu'une ligne de versions: mettez à jour.
