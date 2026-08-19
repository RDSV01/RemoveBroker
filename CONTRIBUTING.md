# Contribuer à RemoveBroker

Le guide complet est dans [docs/CONTRIBUER.md](docs/CONTRIBUER.md). En résumé.

## La contribution la plus utile

Ajouter un courtier européen manquant dans
[`catalog/overrides/eu-fr.yaml`](catalog/overrides/eu-fr.yaml). Dix lignes de
YAML, aucune compétence en programmation nécessaire.

```yaml
- name: Nom de la société
  domain: exemple.fr
  website: https://www.exemple.fr
  email: dpo@exemple.fr
  category: marketing
  regions: [eu, fr]
```

Vérifiez ensuite avec `node scripts/check-catalog.mjs`.

## Développement

```bash
npm install
npm run dev          # serveur 7777, interface 5173
npm run typecheck
npm test
```

## Attentes

- Interface et commentaires en français.
- Les commentaires expliquent pourquoi, pas quoi.
- Pas de dépendance nouvelle sans raison sérieuse.
- **Aucune requête réseau non sollicitée.** Toute modification qui ajoute un
  appel sortant doit le justifier explicitement.

## Licence

Vos contributions sont distribuées sous AGPL-3.0, comme le reste du projet.
