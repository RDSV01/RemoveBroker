# Journal des versions

## 1.1.1

Correctif d'un réglage qui faisait l'inverse de ce qu'il annonçait.

### Corrigé

- **« Relance après (jours) » et « Mise en demeure après (jours) » réglés sur 0
  déclenchaient l'envoi immédiat**, au lieu de le désactiver. La comparaison
  `jours écoulés >= délai` est vraie dès le premier instant quand le délai vaut
  zéro: une demande partie à l'instant recevait aussitôt le courrier annonçant
  la saisine de l'autorité de contrôle, et ce pour chaque courtier de la
  campagne. Zéro veut désormais dire « jamais », ce que tout le monde y lit.
- Aucun moyen ne permettait de désactiver ces envois. `enabled` ne gouvernait
  que le balayage des nouveaux courtiers, pas le suivi.
- Avec les deux réglages à zéro, plus aucun travail de suivi n'est mis en file:
  il ne ferait rien et se replanifierait sans fin.
- La date de prochaine action affichée sur une demande vaut « aucune » quand
  aucun geste automatique n'est prévu, au lieu d'annoncer une échéance qui ne
  viendra pas.
- L'interface indique ce que vaut zéro, et confirme l'extinction une fois le
  réglage enregistré.

## 1.1.0

Version de fiabilité. Elle corrige ce qu'une première utilisation réelle, sur
près de deux mille demandes, a fait apparaître: des envois qui disparaissaient
sans un mot, et des réponses de courtiers mal comprises.

### Corrigé

- **Les demandes reportées ne partaient jamais.** Quand la limite quotidienne
  d'envoi était atteinte, l'envoi replanifiait son travail au lendemain, puis la
  file le marquait « fait » par-dessus. La demande restait affichée « en
  attente » sans que rien ne la porte. Sur la campagne d'essai, 1 429 demandes
  sur 1 977 étaient dans cet état. La file respecte désormais un travail que son
  gestionnaire a replanifié, et les demandes orphelines repartent au démarrage
  comme au clic sur « Reprendre ».
- **Les contacts trouvés sur le site du courtier n'étaient pas utilisés.** La
  recherche lisait la politique de confidentialité, y trouvait l'adresse, la
  notait... et l'envoi relisait le catalogue, où le courtier n'en a pas, pour
  conclure « ce courtier n'accepte pas les demandes par email ». 65 adresses
  trouvées, 64 demandes abandonnées. Les contacts découverts sont maintenant
  superposés au catalogue et utilisables immédiatement.
- **Un répondeur de vacances pouvait valoir « données supprimées ».** Le sujet
  d'une réponse commençant par un marqueur d'absence était analysé en entier, y
  compris notre propre objet « Demande d'effacement de données personnelles »
  recopié après « Re: ». Seul le marqueur est désormais retenu.
- **Une consigne n'est plus prise pour un acte.** « Pour supprimer vos données
  vous avez deux possibilités », « Sur quel site souhaitez-vous que vos données
  soient effacées ? » et « vous pouvez gérer vos informations personnelles »
  concluaient à une suppression confirmée, à 0,99 de confiance.
- **La confiance ne récompense plus l'absence de concurrence.** Elle ne pesait
  que la part relative: un motif isolé à deux points sortait à 0,99. La force
  absolue du motif entre maintenant dans le calcul.
- **Un accord de suppression au futur passait pour un refus.** « We will delete
  your data » déclenchait la règle de négation, dont le « not » était facultatif.
- **La recherche de contact ne laisse plus de demande figée.** Une page qui
  plante le navigateur mettait la demande en « en cours » pour toujours, sans
  travail pour la reprendre. Elle revient à l'utilisateur avec la page à ouvrir.
- **Une adresse qui rebondit n'est plus réessayée à l'identique.** « Réessayer »
  réécrivait au même destinataire inexistant, indéfiniment. Un rebond confirmé
  retire l'adresse de la vue de cette installation et relance la lecture du site
  du courtier. Le message affiché distingue désormais « ce courtier n'accepte
  pas l'email » de « son adresse rebondit »: la première est un choix, la
  seconde une panne.
- **La recherche de contact est bornée dans le temps.** Onze chemins à vingt
  secondes chacun faisaient près de quatre minutes sur un site lent, pour un
  seul courtier, avec deux recherches en parallèle. Mesuré: cinquante minutes
  pour douze courtiers. Un budget de quarante-cinq secondes par courtier et un
  délai de douze secondes par page ramènent la moyenne à treize secondes, sans
  rien perdre: les adresses utiles se trouvent sur les premières pages ou nulle
  part. L'adresse de politique de confidentialité déclarée par la société est
  désormais essayée en premier.
- **Une recherche infructueuse n'est plus définitive.** Le résultat vide était
  mémorisé sans expiration: 88 courtiers sur 136 étaient marqués « rien trouvé »
  pour toujours. L'oubli intervient après trente jours.
- **Les campagnes se terminent.** Aucune ne se fermait: les huit de l'essai
  affichaient encore « en cours » le lendemain, y compris celles d'une seule
  demande aboutie.
- **Le dernier résultat par courtier n'était jamais enregistré.** Un `UPDATE`
  sur une ligne qui n'existait pas encore.
- **Le balayage des nouveaux courtiers n'avait pas lieu.** Le réglage existait
  dans l'interface, rien ne l'appliquait.
- **La limite quotidienne ignorait les relances**, qui partent pourtant par la
  même boîte.
- **Le catalogue publié pouvait maigrir en silence.** L'adresse du répertoire
  Optery pointait vers une branche inexistante: la source répondait 404 à chaque
  reconstruction hebdomadaire et trois cents entrées disparaissaient, sous le
  seuil d'alerte. L'adresse est corrigée, et une source en échec interrompt
  désormais la publication.
- **L'empreinte SHA256 du catalogue est enfin comparée** à celle publiée, comme
  le README l'annonçait. Elle était calculée, jamais vérifiée.
- **Réponses en doublon.** La relève enregistrait cinq fois le même message; les
  doublons déjà en base sont supprimés à la migration.
- **Chronologie illisible.** Un report d'envoi y inscrivait une ligne par jour
  et par demande. Une seule mention subsiste tant que la demande n'a pas bougé.
- Fautes dans les gabarits anglais: « vérification » et « référence » en plein
  texte anglais.
- L'effacement complet oubliait les contacts découverts.

### La liste des actions ne contient plus que des actions

Sur la campagne d'essai, 403 demandes sur 1 977 réclamaient une intervention.
L'outil est fait pour n'en réclamer presque aucune. En les reprenant une par
une, il s'avère que 355 n'en étaient pas:

- **151 attendaient une adresse déjà connue.** Conséquence directe du contact
  découvert mais jamais appliqué (voir plus haut). Elles repartent seules, par
  email, sans rien demander.
- **204 concernaient des sociétés qui ne publient aucun contact.** L'application
  avait lu leur site, suivi ce qu'elle pouvait, et n'avait rien trouvé. Leur
  réponse était « la démarche doit être trouvée sur son site » — c'est-à-dire
  refaire à la main ce qui venait d'échouer, deux cents fois. Elles reçoivent un
  état distinct, **Injoignable**, hors de la liste des actions: le défaut de
  contact est un manquement aux articles 12 et 13 du RGPD, opposable à
  l'autorité de contrôle, pas une corvée à déléguer à l'utilisateur.

Restent **48 actions réelles**: 37 formulaires à examiner, 3 captchas, 2 sociétés
qui exigent leur portail, 2 liens écartés par sécurité, 1 réponse ambiguë. Tout
cela demande un jugement humain par nature.

L'état « Injoignable » n'est pas définitif: une mise à jour du catalogue ou une
nouvelle campagne retentent, et l'avancement affiché ne compte plus ces demandes
au dénominateur — une société qu'on ne peut pas joindre ne mesure pas le travail
accompli.

### Ajouté

- **Reconnaissance des adresses hors service.** « Cette adresse n'est plus en
  service », « CUENTA DE PRIVACIDAD INACTIVA »: ces réponses ressortaient
  « indéterminé » et restaient sans suite alors que la marche à suivre y était
  écrite. La demande revient à l'utilisateur avec le contact indiqué.
- **Absences détectées en allemand, espagnol et italien**, en plus du français
  et de l'anglais.
- **Le sens des réponses s'affiche en français**, avec la confiance associée, au
  lieu de la clé technique (`form_required`, `no_data`).
- Le tableau de bord distingue les suppressions confirmées des courtiers qui ne
  détenaient rien: les additionner annonçait des effacements qui n'ont pas eu
  lieu.
- La vérification du catalogue signale les adresses commerciales ou de
  webmestre, et les boîtes partagées par plusieurs entrées.

### Catalogue

- 1 971 sociétés répertoriées, **1 607 joignables**, dont **110 françaises**.
- `Acxiom France` retiré: `acxiom.fr` ne résout plus et l'entrée doublonnait
  `acxiom.com`, dont l'adresse publiée couvre les demandes européennes.
- Adresses vérifiées ajoutées: `askprivacy@acxiom.com`, `dpo@solocal.com` pour
  Solocal Group et l'Annuaire Pages Blanches.
- La documentation de contribution ne donne plus une adresse inventée en
  exemple.

## 1.0.0

Première version publique.
