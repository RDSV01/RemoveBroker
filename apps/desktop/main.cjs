/**
 * Enveloppe de bureau.
 *
 * Elle ne contient aucune logique métier: elle démarre le serveur local dans
 * son propre processus, ouvre une fenêtre sur son interface, et reste dans la
 * zone de notification pour que les envois programmés continuent quand la
 * fenêtre est fermée.
 *
 * Deux choses justifient son existence plutôt qu'un simple raccourci vers le
 * navigateur:
 *   1. safeStorage donne accès au trousseau du système, donc au chiffrement de
 *      la base sans que l'utilisateur ait à retenir une phrase secrète.
 *   2. l'application doit tourner en arrière-plan pour étaler les envois; une
 *      icône dans la zone de notification rend cet état visible.
 */

const { app, BrowserWindow, Tray, Menu, shell, safeStorage, dialog, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Instance unique: deux serveurs sur le même dossier de données corrompraient
// la base et enverraient les demandes en double.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'dist', 'main.js');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');

let mainWindow = null;
let tray = null;
let serverHandle = null;
let quitting = false;

/** L'utilisateur a-t-il déjà été prévenu que fermer ne quitte pas ? */
let closeNoticeShown = false;

function icon() {
  const image = nativeImage.createFromPath(ICON);
  return image.isEmpty() ? undefined : image;
}

/**
 * Démarrage avec la session.
 *
 * Une campagne s'étale sur plusieurs jours et les réponses arrivent quand elles
 * arrivent. Si l'application ne tourne que lorsque l'utilisateur pense à la
 * lancer, les relances sortent en retard et les liens de confirmation expirent.
 * Elle démarre donc réduite dans la zone de notification, sans fenêtre, et
 * l'utilisateur peut refuser depuis les réglages.
 */
/**
 * --arriere-plan: lancé par le système, on n'ouvre pas de fenêtre.
 *
 * Les mêmes arguments servent à écrire et à relire l'inscription. Sur Windows,
 * getLoginItemSettings compare le chemin et les arguments de l'entrée trouvée
 * à ceux qu'on lui donne: interroger sans argument après avoir inscrit avec
 * `--arriere-plan` renvoyait « désactivé » alors que l'entrée existait bel et
 * bien. L'interrupteur des réglages restait éteint après activation.
 */
const ARGS_DEMARRAGE = ['--arriere-plan'];

function autoStartEnabled() {
  return app.getLoginItemSettings({ args: ARGS_DEMARRAGE }).openAtLogin;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ARGS_DEMARRAGE,
  });
}

async function startServer() {
  const server = await import(pathToFileURL(SERVER_ENTRY).href);

  // Le trousseau du système protège la clé maîtresse: sur Windows via DPAPI,
  // sur macOS via le Keychain, sur Linux via le portefeuille du bureau.
  // L'option existait uniquement dans le menu de l'icone de notification.
  // La fournir au serveur la rend accessible depuis les reglages, la ou on la
  // cherche.
  server.registerAutoStart({ get: autoStartEnabled, set: setAutoStart });

  if (safeStorage.isEncryptionAvailable()) {
    server.registerOsSealer({
      seal: (plain) => safeStorage.encryptString(plain.toString('base64')),
      unseal: (sealed) => Buffer.from(safeStorage.decryptString(sealed), 'base64'),
    });
  }

  serverHandle = await server.startServer({ host: '127.0.0.1' });
  return serverHandle;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f6f3',
    title: 'RemoveBroker',
    icon: icon(),
    autoHideMenuBar: true,
    webPreferences: {
      // L'interface est une page web ordinaire: elle n'a aucun besoin d'accès
      // au système, donc elle n'en reçoit aucun.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Les liens vers les sites des courtiers s'ouvrent dans le navigateur, pas
  // dans une fenêtre de l'application.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  // Aucune navigation hors de l'interface locale.
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!closeNoticeShown && tray) {
      closeNoticeShown = true;
      tray.displayBalloon?.({
        title: 'RemoveBroker continue en arrière-plan',
        content: 'Les demandes programmées continuent de partir. Clic droit sur l\'icône pour quitter vraiment.',
        icon: icon(),
      });
    }
  });
}

function createTray(url) {
  const image = icon();
  if (!image) return;
  // Reconstruit à chaque changement d'état: un menu Electron n'est pas mutable.
  if (tray) tray.destroy();
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('RemoveBroker');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Ouvrir RemoveBroker',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow(url);
      },
    },
    {
      label: 'Ouvrir dans le navigateur',
      click: () => void shell.openExternal(url),
    },
    { type: 'separator' },
    {
      label: 'Démarrer avec la session',
      type: 'checkbox',
      checked: autoStartEnabled(),
      click: (item) => {
        setAutoStart(item.checked);
        // Le menu est figé une fois construit: on le reconstruit pour que la
        // case reflète l'état réel, y compris si le système a refusé.
        createTray(url);
      },
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // Volontairement vide: l'application vit dans la zone de notification.
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', async (event) => {
  if (!serverHandle) return;
  event.preventDefault();
  const handle = serverHandle;
  serverHandle = null;
  try {
    await handle.close();
  } catch {
    /* arrêt au mieux */
  }
  app.exit(0);
});

app.whenReady().then(async () => {
  try {
    const handle = await startServer();
    createTray(handle.url);
    // Lancé par le système au démarrage de session: le moteur tourne, les
    // demandes repartent, mais on n'impose pas une fenêtre à l'ouverture de
    // session. L'icône dans la zone de notification suffit à signaler la vie.
    const launchedBySystem = process.argv.includes('--arriere-plan')
      || app.getLoginItemSettings().wasOpenedAtLogin;
    if (!launchedBySystem) createWindow(handle.url);
  } catch (err) {
    dialog.showErrorBox(
      'RemoveBroker n\'a pas pu démarrer',
      `${err && err.message ? err.message : String(err)}\n\n`
      + 'Si le problème persiste, lancez "removebroker" en ligne de commande '
      + 'pour voir le détail, ou signalez le problème sur GitHub.',
    );
    app.exit(1);
  }
});
