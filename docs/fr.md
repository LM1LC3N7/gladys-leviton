# Leviton Decora Smart Wi-Fi pour Gladys Assistant

Affiche et commande dans Gladys les interrupteurs, variateurs et prises
**Leviton Decora Smart Wi-Fi** (États-Unis, Canada) de votre compte
**My Leviton**, par le cloud de Leviton.

> **API non officielle, jamais testée avec un vrai compte.** L'intégration
> parle à l'API de l'application My Leviton, que Leviton ne documente pas et
> peut changer à tout moment. Elle a été écrite à partir de la bibliothèque
> decora-wifi (celle de l'intégration Home Assistant) et de l'intégration
> Home Assistant de schmittx, et testée seulement avec des réponses
> inventées. Sans lien avec Leviton.

## Ce que vous obtenez

Un appareil Gladys par appareil Leviton pris en charge :

| Appareil Leviton                        | Fonctionnalités Gladys                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Variateur (DW6HD, D26HD, DW1KD, D2ELV…) | Marche/Arrêt (lumière, `light/binary`), Luminosité (0 à 100), En ligne |
| Interrupteur (DW15S, D215S…)            | Marche/Arrêt (interrupteur, `switch/binary`), En ligne                 |
| Prise (DW15P, DW15A, D215P, D215O…)     | Marche/Arrêt (interrupteur, `switch/binary`), En ligne                 |

- **Luminosité** : 0 éteint la lumière ; une autre valeur l'allume, bornée
  aux niveaux minimum et maximum réglés dans l'application.
- **En ligne** (1 = oui, lecture seule) : ce que Leviton dit de l'appareil.
  Un appareil hors ligne est aussi marqué « injoignable » sur sa carte ; son
  dernier état connu reste affiché, sans mise à jour tant qu'il est hors
  ligne, et ses commandes sont refusées.
- **Modèle inconnu** : un appareil dont le modèle n'est pas dans les listes
  de l'intégration est affiché en lecture seule (aucune commande) tant
  qu'elle ne le connaît pas.
- **Consommation** : Leviton n'en donne aucune pour ces appareils dans les
  bibliothèques connues : il n'y en a pas ici.
- Les **ventilateurs** (DW4SF, D24SF), les **télécommandes à boutons**
  (DW4BC), le **pont** (MLWSB) et les **prises différentielles GFCI** (D2GF1,
  D2GF2 : une protection de terre n'est pas une prise à couper depuis
  Gladys) ne sont pas affichés dans cette version.

Les lumières (`light/binary`), interrupteurs et prises (`switch/binary`) sont
des commandes Gladys ordinaires : un « tout éteindre » de Gladys, d'un
assistant vocal ou d'une scène les éteint aussi. N'y branchez pas un
appareil qui ne doit jamais être coupé.

## Mise en place

1. Dans Gladys, installez l'intégration **Leviton Decora Smart Wi-Fi** depuis
   le store.
2. Saisissez l'**e-mail** et le **mot de passe** de votre compte My Leviton
   (ceux de l'application), puis enregistrez : l'enregistrement lance la
   connexion.
3. Si l'état indique « Connexion requise », cliquez sur **Tester la
   connexion** ; s'il indique qu'un code de vérification est demandé, voir
   ci-dessous.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

Le champ du mot de passe est un champ `secret` : Gladys le garde dans sa
base (en clair, comme toute valeur de configuration, et dans ses
sauvegardes), ne le réaffiche jamais, et l'intégration ne l'envoie qu'à My
Leviton (`my.leviton.com`). Il ne sert qu'aux connexions : la session
obtenue est gardée et réutilisée à chaque lecture et après un redémarrage,
jusqu'à sa fin.

### Quand l'intégration se connecte-t-elle ?

Une connexion sans code fait envoyer un code par e-mail à un compte qui
utilise la double authentification. L'intégration ne se connecte donc
d'elle-même (démarrage, reconnexion à Gladys, renouvellement de la session,
nouvel essai espacé) **que pour un compte dont une connexion sans code a
déjà été acceptée** (elle le note dans son `/data`). Pour tout autre compte,
ou si son `/data` est perdu, elle attend un clic : l'état indique
« Connexion requise : cliquez sur Tester la connexion », sans nouvel essai
automatique. Comptent comme un clic : l'enregistrement de la configuration
et les boutons de l'écran de configuration.

Un compte connu « sans code » qui active plus tard la double
authentification peut recevoir **au plus un e-mail**, lors de la connexion
automatique suivante ; il est alors noté comme compte à code et n'est plus
jamais connecté sans clic.

### Code de vérification (double authentification)

Si votre compte My Leviton utilise la double authentification, Leviton
envoie un code par e-mail à chaque connexion sans code. L'intégration
s'arrête alors et l'état l'indique :

1. Sous **Vérifier le code**, saisissez le code du dernier e-mail de
   Leviton et cliquez sur le bouton. « Code accepté » veut dire connecté.
2. Pas d'e-mail, ou code trop vieux ? Cliquez sur **Envoyer le code de
   vérification** : l'intégration se connecte sans code et Leviton envoie un
   nouveau code (au plus une fois par minute).

L'intégration n'envoie jamais de code sans votre clic, ne le garde pas, et
ne se reconnecte jamais d'elle-même pour un compte qui demande un code : la
session est gardée tant que Leviton l'accepte ; quand il la refuse,
l'intégration s'arrête et vous redemande un code.

## Rafraîchissement

Les appareils sont lus toutes les **60 secondes** par défaut (30 à 60,
_Intervalle de rafraîchissement_), en **une requête par résidence** ; la
liste des résidences est relue toutes les heures. Une résidence en erreur
garde ses derniers appareils (marqués « injoignables ») sans empêcher la
lecture des autres.

Une commande part tout de suite ; la valeur confirmée par Leviton s'affiche
aussitôt, l'appareil est relu 2 secondes plus tard, et une lecture un peu en
retard ne défait pas la valeur commandée (15 secondes). Les commandes d'un
même appareil passent l'une après l'autre. Gladys attend 5 secondes la
réponse : une commande qui n'est pas partie 3 secondes après le clic (file
d'attente, connexion en cours, réseau lent) est refusée **sans avoir été
envoyée** ; une commande partie mais lente reçoit sa réponse à 4,3 secondes
et son effet s'affiche ensuite.

## En cas de problème

- **E-mail ou mot de passe refusé** : l'intégration s'arrête, même après un
  redémarrage, et réessaie une fois après 6 heures puis toutes les 24 heures
  (seulement pour un compte connu « sans code » ; sinon elle attend un
  clic). Corrigez-les puis enregistrez, ou cliquez sur _Tester la connexion_.
- **Trop de connexions échouées** (refus de Leviton) : une pause d'une heure,
  commandes et boutons compris, gardée après un redémarrage.
- **Session refusée** : une seule nouvelle connexion ; refusée à nouveau,
  l'intégration se met en pause et réessaie après 1 heure, 6 heures, puis
  toutes les 24 heures. _Tester la connexion_ réessaie tout de suite.
- **Trop de requêtes (429)** : une pause de 1 minute à 6 heures (le
  `Retry-After` de Leviton, 15 minutes sans lui), pour les lectures, les
  commandes et les boutons, gardée après un redémarrage ou une reconnexion à
  Gladys.
- **HTTP 403** des lectures : il déclenche d'abord une nouvelle connexion
  (comme un jeton refusé) ; s'il reste, une pause d'une heure.
- **Leviton indisponible (5xx, réseau)** : nouveaux essais après 1, 2, 5, 10,
  puis toutes les 15 minutes, jamais plus vite que l'intervalle.

## Limites

- API non officielle : Leviton peut la changer, la bloquer ou demander plus
  de vérifications.
- Pas de mises à jour en direct (le canal websocket de l'application) : une
  lecture toutes les 30 à 60 secondes.
- Un seul compte My Leviton par Gladys, dix résidences au plus.
- Pas de ventilateurs, de prises GFCI, de détecteur de mouvement (D2MSD :
  seulement la lumière), de scènes, de programmes ni de réglages (LED,
  fondu…) dans cette version.
- Jamais testée avec un vrai compte : merci de signaler ce que vous voyez sur
  le [dépôt GitHub](https://github.com/LM1LC3N7/gladys-leviton/issues) (sans
  votre e-mail, mot de passe ni codes).

## Vie privée

L'intégration garde dans `/data/leviton-state.json` (lisible par son seul
conteneur) : le jeton de session, l'identifiant d'utilisateur Leviton et la
fin du jeton, le compte auquel ils appartiennent sous forme d'empreinte de
l'e-mail, les comptes (empreintes) connus « sans code » et ceux qui
demandent un code, l'heure de la dernière demande de code, la fin d'une
pause, et un arrêt sur identifiants refusés lié à une empreinte salée de
l'e-mail et du mot de passe. Ni l'e-mail, ni le mot de passe, ni les codes.
L'adresse MAC, le numéro de série et l'adresse IP locale des appareils ne
sont pas transmis à Gladys. Rien n'est envoyé ailleurs qu'à My Leviton.
