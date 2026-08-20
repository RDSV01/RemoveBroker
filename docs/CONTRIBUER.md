# Contribuer

La contribution la plus utile n'est pas du code: c'est **un courtier européen de
plus dans le catalogue**. Les sources publiques couvrent bien la publicite,
mal l'Europe, et personne ne peut combler ce trou seul.

## Ajouter un courtier

Ouvrez [`catalog/overrides/eu-fr.yaml`](../catalog/overrides/eu-fr.yaml) et
ajoutez une entrée:

```yaml
- name: Nom commercial de la société
  domain: exemple.fr
  website: https://www.exemple.fr
  email: dpo@exemple.fr
  optOutUrl: https://www.exemple.fr/vos-droits
  category: marketing
  regions: [eu, fr]
  notes: Ce qu'il faut savoir avant d'écrire à cette société.
```

Seuls `name` et un moyen de contact sont indispensables. Les champs:

| Champ | Rôle |
| --- | --- |
| `name` | Nom affiché. Le nom commercial, pas la raison sociale |
| `domain` | Domaine principal, sert d'identifiant unique |
| `website` | Site public |
| `email` | Adresse du délégué à la protection des données |
| `optOutUrl` | Page ou formulaire d'exercice des droits |
| `guideUrl` | Marche à suivre détaillée, si elle existe |
| `category` | Voir la liste ci-dessous |
| `regions` | `fr`, `eu`, `uk`, `us`, `ca`, `au`, `intl` |
| `requiresId` | `true` si une pièce d'identité est systématiquement exigée |
| `notes` | Contexte utile, affiché dans la fiche |

Catégories: `people-search`, `phone-directory`, `background-check`, `b2b`,
`business-search`, `marketing`, `location`, `credit-risk`, `health`, `other`.

Utilisez `location` pour les sociétés qui revendent des traces de déplacement
rattachées à un identifiant publicitaire: les demandes qui leur sont adressées
contiennent des exigences spécifiques, et l'identifiant de l'utilisateur y est
joint quand il l'a renseigné.

Avant d'ajouter une société, vérifiez qu'on peut réellement en obtenir la
suppression. Les rediffuseurs de registres publics n'ont pas leur place dans le
catalogue: voir [PERIMETRE.md](PERIMETRE.md).

### Corriger une entrée existante

Les entrées issues des sources publiques ne se modifient pas directement: le
fichier serait écrasé à la reconstruction suivante. Utilisez un correctif,
identifié par le domaine:

```yaml
- patch: true
  domain: acxiom.com
  email: askprivacy@acxiom.com
  regions: [us, eu]
  notes: Filiale européenne soumise au RGPD.
```

L'adresse doit être celle que la société publie elle-même. Celle de cet exemple
figure dans l'avis de confidentialité RGPD d'Acxiom. N'inventez jamais une
adresse plausible à partir du nom de domaine: elle rebondit, la demande part en
échec, et le courtier passe pour injoignable alors qu'il ne l'est pas.

Pour retirer une entrée invalide, par exemple une société qui n'existe plus:

```yaml
- patch: true
  domain: societe-disparue.com
  remove: true
```

### Où trouver l'adresse à renseigner

Dans la politique de confidentialité de la société: l'article 13 du RGPD lui
impose d'y publier un moyen de contact. Cherchez « délégué à la protection des
données », « DPO », « exercer vos droits ». Un script fait ce travail
automatiquement pour les entrées qui n'ont pas d'adresse:

```bash
node scripts/enrich-catalog.mjs --only eu
```

Ne renseignez `email:` à la main que si vous avez vérifié l'adresse. Une adresse
inventée produit un rebond des semaines plus tard, et l'utilisateur croit sa
demande partie.

### Vérifier votre ajout

```bash
npm run catalog:build     # reconstruit le catalogue
node scripts/check-catalog.mjs   # vérifie la cohérence
```

Le second refuse les doublons, les adresses mal formées, les URL illisibles et
les catégories inconnues. L'intégration continue exécute le même script.

Vous n'avez pas besoin de committer `catalog/catalog.json`: il est reconstruit
chaque semaine automatiquement. Committez uniquement votre fichier
`overrides/`.

## Écrire une recette d'automatisation

Une recette décrit comment remplir le formulaire d'opt-out d'un site. Elles
vivent dans [`catalog/recipes/`](../catalog/recipes/).

```yaml
- id: exemple
  domain: exemple.fr
  name: Exemple
  kind: direct-form        # ou search-form si le site exige de trouver sa fiche
  captcha: none            # none, recaptcha, hcaptcha, turnstile, unknown
  form:
    url: https://www.exemple.fr/suppression
    fields:
      - selector: 'input[name="email"]'
        value: '{{email}}'
      - selector: 'input[name="nom"]'
        value: '{{lastName}}'
      - selector: 'textarea[name="motif"]'
        value: '{{reason}}'
        optional: true
    submit: 'button[type="submit"]'
    success:
      urlContains: [confirmation]
      text: ['votre demande a bien été enregistrée']
  confirmByEmail: true
  expectedSender: noreply@exemple.fr
```

Variables disponibles: `fullName`, `firstName`, `lastName`, `email`, `phone`,
`city`, `state`, `stateCode`, `postalCode`, `country`, `addressLine1`,
`birthYear`, `listingUrl`, `reason`, `advertisingId`.

`advertisingId` est vide si l'utilisateur ne l'a pas renseigné: marquez le champ
`optional: true` dans la recette pour que la soumission reste possible.

Pour un site de recherche de personnes, où il faut d'abord trouver sa fiche:

```yaml
  kind: search-form
  search:
    url: https://www.exemple.fr/recherche?q={{fullName}}&ville={{city}}
    listingPattern: 'exemple\.fr/profil/\d+'
```

Deux règles:

1. **Des sélecteurs tolérants.** `input[type="email"], input[name="email"]`
   survit à une refonte du site; `#form > div:nth-child(3) > input` non.
2. **Des critères de succès explicites.** Sans eux, la soumission est marquée
   incertaine et l'utilisateur devra vérifier à la main.

Testez avec:

```bash
npm run browsers:install
npm run build
node scripts/test-recipe.mjs exemple            # remplit sans soumettre
node scripts/test-recipe.mjs exemple --envoyer  # va jusqu'au bout
```

Le navigateur s'ouvre en fenêtre visible avec un profil fictif. Sans
`--envoyer`, le formulaire est rempli mais jamais soumis: vous pouvez régler vos
sélecteurs sans envoyer de demande au nom d'une personne inexistante.

## Contribuer au code

```bash
git clone https://github.com/RDSV01/RemoveBroker.git
cd RemoveBroker
npm install
npm run dev        # serveur sur 7777, interface sur 5173 avec rechargement
```

Utilisez `npm install`, jamais `npm ci`. Rollup et esbuild livrent leur binaire
dans une dépendance optionnelle propre à chaque plateforme, et npm n'inscrit
dans le verrou que celle de la machine qui l'a généré
([npm/cli#4828](https://github.com/npm/cli/issues/4828), toujours ouvert avec
npm 11). Le verrou de ce dépôt a été produit sous Windows: `npm ci`, qui refuse
de s'en écarter, échouerait à la compilation sur Linux et macOS. L'intégration
continue et l'image Docker retirent le verrou avant d'installer, pour la même
raison.

Avant d'ouvrir une proposition de modification:

```bash
npm run typecheck
npm test
node scripts/check-catalog.mjs
```

### Ce que le projet attend du code

- **Du français dans l'interface et les commentaires.** C'est un outil destiné
  d'abord au public francophone; le code parle la même langue que ses lecteurs.
- **Des commentaires qui expliquent pourquoi**, pas ce que fait la ligne
  suivante. Une constante de temporisation mérite une phrase sur la raison de sa
  valeur.
- **Aucune dépendance nouvelle sans raison sérieuse.** Chaque paquet ajouté est
  du code que personne ne relira.
- **Aucune requête réseau non sollicitée.** C'est la règle de fond du projet: si
  votre modification ajoute un appel sortant, elle doit l'expliquer dans la
  proposition.

### Structure du dépôt

```
apps/server     API, moteur d'envoi, chiffrement, modèles d'emails
apps/web        interface React
apps/desktop    enveloppe Electron
catalog         catalogue compilé, contributions, recettes
scripts         construction et vérification du catalogue
docs            documentation
```

Le détail des choix techniques est dans [ARCHITECTURE.md](ARCHITECTURE.md).

## Signaler un problème

- **Un courtier ne répond jamais** — dites-le dans une issue, c'est une donnée
  utile pour la note affichée.
- **Une réponse mal classée** — collez le texte du message, sans vos données
  personnelles. Le classificateur s'améliore avec des exemples réels.
- **Une faille de sécurité** — n'ouvrez pas d'issue publique, voir
  [SECURITY.md](../SECURITY.md).

## Licence des contributions

En contribuant, vous acceptez que votre code soit distribué sous AGPL-3.0,
comme le reste du projet.
