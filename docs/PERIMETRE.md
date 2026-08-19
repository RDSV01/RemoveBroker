# Ce que le catalogue contient, et ce qu'il ne contient pas

RemoveBroker couvre **la France et l'Europe**. Deux règles décident de l'entrée
d'une société, et elles se cumulent.

## Première règle: la suppression doit être possible

> **Peut-on obtenir la suppression de ses données chez elle ?**

Si la réponse est non par construction, l'entrée n'a rien à y faire. Envoyer
une demande vouée au refus fait perdre du temps à l'utilisateur, encombre son
tableau de bord, et abîme le seul chiffre qui compte: la part de demandes qui
aboutissent réellement.

## Seconde règle: la donnée doit concerner une personne en Europe

Le critère n'est pas le siège social. Une société américaine qui exploite les
données de personnes vivant en Europe relève du RGPD et doit répondre dans le
mois: Acxiom, LiveRamp, Kochava ou The Trade Desk détiennent des données
françaises et figurent au catalogue.

En revanche, un annuaire de dossiers publics américains ne détient rien sur une
personne qui n'a jamais vécu aux États-Unis. **863 entrées de ce type ont été
retirées**: recherche de personnes, casiers judiciaires, registres électoraux,
annuaires téléphoniques locaux. Leur présence ne produisait que des réponses
« aucune donnée vous concernant » et noyait les demandes qui aboutissent.

Quatre signaux établissent qu'une société traite des données européennes:

- elle est établie en France, dans l'Union, au Royaume-Uni ou en Suisse;
- elle figure dans la liste des fournisseurs du cadre de consentement européen,
  ce qui revient à le déclarer;
- elle revend de la localisation: ces sociétés achètent des traces à des
  applications du monde entier, rattachées à un identifiant publicitaire qui ne
  dit rien du pays. Outlogic, Veraset et SafeGraph n'apparaissent dans aucune
  liste européenne et détiennent pourtant les déplacements d'Européens;
- **sa propre politique de confidentialité le reconnaît**.

Ce dernier critère est le plus sûr, parce qu'il ne repose sur aucune supposition
de notre part. [`scripts/detect-rgpd.mjs`](../scripts/detect-rgpd.mjs) lit la
politique publiée par chaque société hors d'Europe et y cherche ce qu'on
n'écrit pas sans traiter de données européennes: une section RGPD, les droits
des résidents de l'Espace économique européen, les clauses contractuelles types,
un délégué à la protection des données, une autorité de contrôle. Deux mentions
distinctes sont exigées, pour qu'une formule isolée ne suffise pas.

Le verdict n'écarte une société que s'il est établi. Une politique illisible
sans navigateur, un site injoignable, et l'entrée reste: une absence de preuve
n'est pas une preuve d'absence. Sur 705 sociétés examinées, 166 reconnaissent
le droit européen, 208 n'évoquent que le droit américain, et 331 n'ont pas pu
être jugées et restent au catalogue.

Le détecteur se trompe parfois. Choreograph, filiale du groupe britannique WPP,
ne publie qu'un sélecteur de langue à l'adresse de sa politique: aucune mention
lisible, et pourtant elle traite les demandes RGPD. Ces cas se corrigent à la
main dans [`catalog/overrides`](../catalog/overrides), avec le motif.

## Ce qui entre

Les cinq familles couvertes, alignées sur ce que traitent les services payants
équivalents:

| Famille | Exemples | Pourquoi ça marche |
| --- | --- | --- |
| Recherche de personnes | Copains d'avant, Trombi, 123people, WebMii | Fiches publiques nominatives, suppression de droit |
| Annuaires téléphoniques | PagesBlanches, 118 712, Das Telefonbuch, Paginebianche | Opposition à l'annuaire universel, droit explicite |
| Publicité et audiences | Criteo, Sirdata, Weborama, Numberly, ID5, Utiq | Consentement retirable, aucune base légale de conservation |
| Localisation mobile | Kochava, Azira, Outlogic, Foursquare, Blis | Traces liées à un identifiant publicitaire, effaçables |
| Prospection et solvabilité | Kaspr, Nomination, Dropcontact, Creditsafe, SCHUFA | Droit d'effacement ou d'opposition selon le traitement |

Pour la solvabilité, l'effacement pur est parfois refusé à juste titre: un
bureau de crédit peut être tenu de conserver un historique. La demande reste
utile, parce qu'elle oblige à révéler ce qui est détenu, et ouvre le droit de
rectification.

## Ce qui n'entre pas

### Les rediffuseurs de registres publics

Infogreffe, Pappers, Societe.com, Verif.com et leurs équivalents européens
republient le RNCS et le BODACC. Leur traitement repose sur une obligation
légale, et l'article 17(3)(b) du RGPD exclut explicitement le droit à
l'effacement dans ce cas. Une demande n'y produit qu'un refus motivé.

Le droit existe pourtant, mais il s'exerce autrement, et l'application le
rappelle plutôt que de faire semblant:

- **Adresse personnelle d'un dirigeant**: opposition à sa communication aux
  tiers, à demander au registre national des entreprises, pas au rediffuseur.
- **Désindexation par les moteurs de recherche**: demande à Google ou Bing, qui
  relève d'un autre régime que l'effacement à la source.

### Les traitements imposés par la loi

Administrations, organismes de sécurité sociale, obligations comptables. Ni le
logiciel ni son utilisateur ne peuvent obtenir un effacement contre une
obligation légale.

### Les services dont vous êtes client

Votre banque, votre opérateur, vos comptes en ligne. Ce sont vos données chez
un prestataire que vous avez choisi, pas une revente à votre insu. La demande
se fait auprès d'eux directement, et fermer le compte est généralement le bon
geste.

## Cas limites

**Une société refuse systématiquement.** Elle reste dans le catalogue si le
refus n'est pas fondé: le refus lui-même est la matière d'une plainte auprès de
l'autorité de contrôle.

**Une société ne répond jamais.** Elle reste, tant que son domaine répond. Le
silence passé le délai légal est un manquement, et l'application prépare la
plainte correspondante.

**Le domaine est éteint.** L'entrée sort. L'enrichissement hebdomadaire
distingue un domaine qui ne résout plus d'un site simplement fermé aux robots,
et seul le premier cas provoque un retrait, à condition qu'aucun contact ne soit
connu par ailleurs. Si un examen ultérieur retrouve le site vivant, l'entrée
revient d'elle-même: le catalogue est reconstruit depuis les sources à chaque
passage.

**Aucun contact trouvé.** L'entrée reste, mais elle n'est pas comptée parmi les
sociétés joignables et la campagne recommandée l'ignore. Une demande y
supposerait d'explorer le site depuis le poste de l'utilisateur, longuement et
le plus souvent en vain puisque l'enrichissement a déjà échoué. Le mode complet
les inclut, pour qui veut tenter malgré tout.

Le chiffre mis en avant par le projet est celui des sociétés joignables, jamais
le total répertorié. Annoncer un catalogue de plusieurs milliers d'entrées dont
une partie ne mène nulle part serait le genre de chiffre que ce projet reproche
aux services payants.

**Une source tombe en panne.** La reconstruction s'arrête. Le script refuse
d'écrire si plus d'un cinquième des entrées disparaîtrait d'une semaine sur
l'autre: une telle perte traduit une source injoignable, jamais une évolution
réelle du marché. Le catalogue précédent est conservé, et l'intégration
continue échoue au lieu de publier une version amputée à toutes les
installations.

## Proposer un retrait

Les sources amont sont larges: le registre californien, l'annuaire Optery et la
base Datenanfragen listent aussi des sociétés qui ne sont pas des courtiers.
Celles qui passent le filtre automatique sans mériter d'y être sont écartées à
la main dans
[`catalog/overrides/hors-perimetre.yaml`](../catalog/overrides/hors-perimetre.yaml),
avec le motif:

```yaml
- patch: true
  remove: true
  domain: exemple.com
  notes: Pourquoi cette entrée ne peut pas produire de suppression.
```

C'est une contribution aussi utile qu'un ajout: le catalogue vaut par ce qu'il
contient autant que par ce qu'il a écarté. Si le refus vous a été opposé par
écrit, citez la base légale invoquée.
