// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, command errors, feature
// names), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  power: both('On/Off', 'Marche/Arrêt'),
  brightness: both('Brightness', 'Luminosité'),
  online: both('Online (1 = yes)', 'En ligne (1 = oui)'),
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

const retry = (wait) =>
  wait
    ? both(`One new try in ${wait.en}.`, `Un nouvel essai dans ${wait.fr}.`)
    : both(
        'The integration waits for a change of the configuration (or a button).',
        "L'intégration attend une modification de la configuration (ou un bouton).",
      );

export const T = {
  noCredentials: both(
    'Enter the e-mail and the password of your My Leviton account (the ones of the app).',
    "Saisissez l'e-mail et le mot de passe de votre compte My Leviton (ceux de l'application).",
  ),
  connecting: both('Signing in to My Leviton…', 'Connexion à My Leviton…'),
  connected: (count, supported) =>
    both(
      `Connected to My Leviton: ${supported} device(s) Gladys can show (out of ${count}). Open Discovery to add them.`,
      `Connecté à My Leviton : ${supported} appareil(s) que Gladys peut afficher (sur ${count}). Ouvrez Découverte pour les ajouter.`,
    ),
  refused: (wait) =>
    join(
      both(
        'My Leviton refused the e-mail or the password: check them in the configuration.',
        "My Leviton a refusé l'e-mail ou le mot de passe : vérifiez-les dans la configuration.",
      ),
      retry(wait),
    ),
  loginRejected: (status, wait) =>
    join(
      both(
        `My Leviton rejected the sign-in (HTTP ${status}): sign in once in the My Leviton app; if it stays, the integration needs an update.`,
        `My Leviton a rejeté la connexion (HTTP ${status}) : connectez-vous une fois dans l'application My Leviton ; si cela reste, l'intégration doit être mise à jour.`,
      ),
      retry(wait),
    ),
  locked: (wait) =>
    both(
      `My Leviton saw too many failed sign-ins: pausing for ${wait.en}, commands included. Check the password meanwhile.`,
      `My Leviton a vu trop de connexions échouées : pause de ${wait.fr}, commandes comprises. Vérifiez le mot de passe en attendant.`,
    ),
  twoFactor: both(
    'Your My Leviton account asks for a verification code. Leviton e-mails one at each sign-in without code: no e-mail? Click "Send the verification code", then type the code under "Verify the code" in this configuration screen.',
    "Votre compte My Leviton demande un code de vérification. Leviton en envoie un par e-mail à chaque connexion sans code : pas d'e-mail ? Cliquez sur « Envoyer le code de vérification », puis saisissez le code sous « Vérifier le code » dans cet écran de configuration.",
  ),
  sessionRefused: (wait) =>
    both(
      `My Leviton refused the session again right after a new sign-in: the integration paused. New try in ${wait.en}, or click "Test the connection".`,
      `My Leviton a de nouveau refusé la session juste après une nouvelle connexion : l'intégration est en pause. Nouvel essai dans ${wait.fr}, ou cliquez sur « Tester la connexion ».`,
    ),
  busy: both(
    'A read of My Leviton is in progress: try again in a minute.',
    'Une lecture de My Leviton est en cours : réessayez dans une minute.',
  ),
  unreachable: (reason, wait) =>
    both(
      `My Leviton cannot be reached (${reason}). Next try in ${wait.en}.`,
      `My Leviton est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
    ),
  rateLimited: (wait) =>
    both(
      `My Leviton asks to slow down (HTTP 429): pausing for ${wait.en}, commands included.`,
      `My Leviton demande de ralentir (HTTP 429) : pause de ${wait.fr}, commandes comprises.`,
    ),
  forbidden: (wait) =>
    both(
      `My Leviton refuses the requests (HTTP 403): pausing for ${wait.en}.`,
      `My Leviton refuse les requêtes (HTTP 403) : pause de ${wait.fr}.`,
    ),
  code: {
    needsFields: both(
      'This version of Gladys did not send the form of the button: update Gladys.',
      "Cette version de Gladys n'a pas envoyé le formulaire du bouton : mettez Gladys à jour.",
    ),
    sent: both(
      'Leviton is e-mailing you a code. Type it under "Verify the code".',
      'Leviton vous envoie un code par e-mail. Saisissez-le sous « Vérifier le code ».',
    ),
    notNeeded: both(
      'My Leviton accepted the sign-in without a code: connected.',
      'My Leviton a accepté la connexion sans code : connecté.',
    ),
    cooldown: both(
      'A sign-in was started less than a minute ago: wait for its e-mail, or try again in a minute.',
      "Une connexion a été lancée il y a moins d'une minute : attendez son e-mail, ou réessayez dans une minute.",
    ),
    badFormat: both(
      'The code is made of 4 to 12 letters or digits.',
      'Le code est composé de 4 à 12 lettres ou chiffres.',
    ),
    refused: both(
      'My Leviton refused the code: check it (the last e-mail), or ask for a new one.',
      'My Leviton a refusé le code : vérifiez-le (le dernier e-mail), ou demandez-en un nouveau.',
    ),
    alreadyConnected: both(
      'Already connected to My Leviton: no code is needed.',
      "Déjà connecté à My Leviton : aucun code n'est nécessaire.",
    ),
    verified: both(
      'Code accepted: connected to My Leviton.',
      'Code accepté : connecté à My Leviton.',
    ),
    failed: (reason) =>
      both(
        `My Leviton could not be reached (${reason}): try again in a moment.`,
        `My Leviton est injoignable (${reason}) : réessayez dans un moment.`,
      ),
  },
  test: {
    cooldown: both(
      'Already read less than 30 seconds ago.',
      'Déjà lu il y a moins de 30 secondes.',
    ),
  },
};

/** Command errors: the message Gladys shows when a command is refused. */
export const ERRORS = {
  unknown: both(
    'This feature cannot be commanded (unknown to My Leviton now)',
    'Cette fonctionnalité ne peut pas être commandée (inconnue de My Leviton pour le moment)',
  ),
  blocked: both(
    'My Leviton is not connected: see the integration status',
    "My Leviton n'est pas connecté : voir l'état de l'intégration",
  ),
  paused: both(
    'My Leviton asked to slow down: commands paused, try again later',
    'My Leviton a demandé de ralentir : commandes en pause, réessayez plus tard',
  ),
  late: both(
    'My Leviton is slow: the command was not sent (Gladys waits 5 seconds)',
    "My Leviton est lent : la commande n'a pas été envoyée (Gladys attend 5 secondes)",
  ),
  offline: both(
    'The device is offline for My Leviton: nothing sent',
    "L'appareil est hors ligne pour My Leviton : rien n'a été envoyé",
  ),
  invalidValue: both('Invalid value', 'Valeur invalide'),
  refused: (reason) =>
    both(
      `My Leviton refused the command (${reason})`,
      `My Leviton a refusé la commande (${reason})`,
    ),
  unsure: (reason) =>
    both(
      `The command was sent but its result is unknown (${reason}): the next read will show it`,
      `La commande est partie mais son résultat est inconnu (${reason}) : la prochaine lecture le montrera`,
    ),
};
