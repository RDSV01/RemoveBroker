# Installation

Trois façons d'installer RemoveBroker, de la plus simple à la plus technique.

## 1. Installateur (recommandé)

Rendez-vous sur la [page des versions](https://github.com/RDSV01/RemoveBroker/releases)
et téléchargez le fichier correspondant à votre système.

### Windows

Lancez `RemoveBroker-1.1.0-installateur.exe`.

Windows affiche « Windows a protégé votre ordinateur » parce que l'installateur
n'est pas signé par un certificat commercial, qui coûte plusieurs centaines
d'euros par an. Cliquez sur **Informations complémentaires**, puis sur
**Exécuter quand même**.

L'installation ne demande pas les droits administrateur et n'écrit que dans
votre dossier utilisateur.

### macOS

Ouvrez le `.dmg`, glissez RemoveBroker dans Applications. Au premier lancement,
macOS refuse d'ouvrir une application non signée: faites un **clic droit** sur
l'icône, puis **Ouvrir**, et confirmez. La deuxième fois, un double-clic suffit.

Si le message « l'application est endommagée » apparaît:

```bash
xattr -dr com.apple.quarantine /Applications/RemoveBroker.app
```

### Linux

```bash
chmod +x RemoveBroker-1.1.0-x64.AppImage
./RemoveBroker-1.1.0-x64.AppImage
```

Ou installez le paquet Debian:

```bash
sudo dpkg -i removebroker_1.1.0_amd64.deb
```

### Vérifier votre téléchargement

Chaque version publie un fichier `SHA256SUMS.txt`. Comparez-le à l'empreinte de
votre fichier:

```bash
# Windows (PowerShell)
Get-FileHash .\RemoveBroker-1.1.0-installateur.exe -Algorithm SHA256

# macOS et Linux
shasum -a 256 RemoveBroker-1.1.0-x64.AppImage
```

Si les empreintes diffèrent, ne lancez pas le fichier.

## 2. Depuis les sources

Utile pour contribuer, relire le code avant de l'exécuter, ou faire tourner
l'application sur un système sans installateur.

Prérequis: [Node.js](https://nodejs.org) 20.11 ou plus récent.

```bash
git clone https://github.com/RDSV01/RemoveBroker.git
cd RemoveBroker
npm install
npm run build
npm start
```

Ouvrez ensuite `http://127.0.0.1:7777`.

Pour la fenêtre de bureau plutôt qu'un onglet de navigateur:

```bash
npm run desktop
```

Pour reconstruire vous-même les installateurs:

```bash
npm run dist        # votre système courant
npm run dist:win    # Windows
```

## 3. Docker

Pour faire tourner l'application sur un serveur personnel ou un NAS.

```bash
docker compose up -d
```

L'interface est sur `http://127.0.0.1:7777`, les données dans le volume
`removebroker-data`.

Dans ce mode, le trousseau du système n'est pas disponible: choisissez le
chiffrement par phrase secrète dans **Paramètres, Confidentialité**, ou
fournissez la clé au démarrage via `RB_MASTER_KEY`.

**N'exposez pas ce port sur Internet.** L'API n'a pas d'authentification: elle
suppose que seule la personne devant la machine peut l'atteindre. Si vous devez
y accéder à distance, passez par un tunnel SSH ou un VPN.

## Variables d'environnement

Toutes optionnelles.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `RB_PORT` | Port d'écoute | `7777` |
| `RB_HOST` | Interface d'écoute | `127.0.0.1` |
| `RB_DATA_DIR` | Dossier des données | dossier applicatif du système |
| `RB_PASSPHRASE` | Phrase secrète, mode chiffré par phrase | — |
| `RB_MASTER_KEY` | Clé maîtresse en base64, 32 octets | — |

Le port par défaut peut être occupé par un autre logiciel: l'application essaie
alors les suivants et affiche l'adresse retenue au démarrage.

## Où sont mes données

| Système | Emplacement |
| --- | --- |
| Windows | `%APPDATA%\RemoveBroker` |
| macOS | `~/Library/Application Support/RemoveBroker` |
| Linux | `~/.local/share/removebroker` |

Ce dossier contient la base chiffrée, la clé, les copies des emails et le
journal. Le sauvegarder revient à sauvegarder toute votre installation; le
supprimer efface tout.

## Automatisation des formulaires

Certains courtiers n'acceptent pas de demande par email. L'application peut
remplir leur formulaire à votre place, ce qui suppose un navigateur dédié
(environ 300 Mo). Il n'est pas inclus dans l'installateur: il se télécharge
depuis **Paramètres, Automatisation** uniquement si vous activez cette option.

En ligne de commande:

```bash
npm run browsers:install
```

## Désinstaller

1. Ouvrez **Paramètres, Mes données**, puis **Tout effacer**. Cela supprime le
   profil, l'historique et la clé de chiffrement.
2. Désinstallez l'application par les moyens habituels de votre système.
3. Si vous n'avez pas fait l'étape 1, supprimez à la main le dossier de données
   indiqué plus haut.

Les demandes déjà envoyées aux courtiers restent valables: la loi les oblige à y
répondre, que le logiciel soit installé ou non.
