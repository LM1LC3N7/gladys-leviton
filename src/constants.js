// -----------------------------------------------------------------------------
// Manifest keys, My Leviton constants, limits and timings.
//
// The API is the one of the My Leviton app (Leviton Cloud Services, a LoopBack
// REST API on my.leviton.com), undocumented. The host, the sign-in, the
// `authorization` header, the paths and the `power` / `brightness` writes are
// those of decora-wifi (MIT, tlyakhov/python-decora_wifi), the library of the
// decora_wifi integration of Home Assistant (Apache-2.0), cross-checked with
// homebridge-myleviton (Apache-2.0, tbaur). The verification code (406, then
// the login again with `code`) and the model list follow
// home-assistant-leviton-decora-smart-wifi (MIT, schmittx).
// -----------------------------------------------------------------------------

export const API_ROOT = 'https://my.leviton.com/api';

const id = (value) => encodeURIComponent(value);

/** API paths, relative to API_ROOT. */
export const PATHS = {
  /** decora-wifi Person.login; `include=user` as homebridge-myleviton and schmittx. */
  login: '/Person/login?include=user',
  permissions: (person) => `/Person/${id(person)}/residentialPermissions`,
  residences: (account) => `/ResidentialAccounts/${id(account)}/residences`,
  switches: (residence) => `/Residences/${id(residence)}/iotSwitches`,
  switch: (device) => `/IotSwitches/${id(device)}`,
};

/** An honest User-Agent: this integration, its version line and its repository. */
export const USER_AGENT = 'gladys-leviton/0.1 (+https://github.com/LM1LC3N7/gladys-leviton)';

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  REQUEST_CODE: 'request_code',
  VERIFY_CODE: 'verify_code',
};

/** Refresh interval, in seconds (the brief: 30 to 60 s; homebridge-myleviton polls every 30 s). */
export const POLL_INTERVAL = { min: 30, max: 60, default: 60 };

/**
 * Models (schmittx's SUPPORTED_DEVICES and homebridge-myleviton's
 * device-models.ts). Dimmers become a Gladys light with a brightness; fans,
 * button controllers and bridges are not shown in this version.
 */
export const MODELS = {
  dimmers: new Set([
    'DWVAA',
    'DW1KD',
    'DW6HD',
    'D26HD',
    'D23LP',
    'DW3HL',
    'D2ELV',
    'D2710',
    'DN6HD',
    'D36HD',
    'D2MSD',
  ]),
  outlets: new Set(['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O', 'D215R', 'D2GF1', 'D2GF2']),
  switches: new Set(['DW15S', 'D215S', 'D315S', 'DN15S', 'D2SCS']),
  /** Not shown: fan speed controllers, button controllers, the Wi-Fi bridge. */
  hidden: new Set(['DW4SF', 'D24SF', 'DW4BC', 'MLWSB']),
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept for the commands. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** A device list of a large home is a few hundred KB. */
  responseBytes: 2 * 1024 * 1024,
  /** Residences read per account (one request each per cycle). */
  residences: 10,
  /** Devices published (Gladys accepts 2000 per publication). */
  devices: 500,
  /** Longest text kept from an answer (names, models, versions). */
  textLength: 100,
  /** Accounts remembered as using the verification code. */
  twoFactorAccounts: 5,
};

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** decora-wifi waits 15 s, homebridge-myleviton 10 s. */
  requestTimeout: 10 * SECOND,
  /** The buttons (60 s for Gladys): shorter requests. */
  quickTimeout: 8 * SECOND,
  /** The residences of the account are read again every hour (the devices every cycle). */
  topologyInterval: HOUR,
  /**
   * The token lives `ttl` seconds (LoopBack); homebridge-myleviton assumes one
   * hour without it. It is renewed (a new sign-in) a tenth of its life before
   * it ends, at least 5 minutes, at most 1 hour before, and only for an account
   * that never asked for a code: one that does keeps its token until Leviton
   * refuses it.
   */
  tokenDefaultTtl: HOUR,
  tokenMarginMin: 5 * MINUTE,
  tokenMarginMax: HOUR,
  /**
   * Commands (Gladys waits 5 s for the ack): the request must leave within
   * 3 s of the click, or the command is refused unsent; Gladys is answered at
   * 4.3 s at the latest, the request then finishing in the background.
   */
  commandSendBy: 3 * SECOND,
  commandAck: 4300,
  /** The device is read again this long after a command, to show its real state. */
  rereadAfterCommand: 2 * SECOND,
  /** A commanded value wins over an older polled one this long, unless a read confirms it. */
  commandHold: 15 * SECOND,
  /** Pauses after a failed read, never shorter than the interval: 1, 2, 5, 10, then 15 min. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** 429: Retry-After bounded to 1 minute .. 6 hours, 15 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 15 * MINUTE,
  /** "Too many failed attempts" (403 of the sign-in): one hour, every path. */
  lockedPause: HOUR,
  /** A 403 of the API that a new token does not cure: one hour, every path. */
  forbiddenPause: HOUR,
  /** A refused e-mail/password or a rejected sign-in: one new try after 6 h, then every 24 h. */
  refusedRetry: [6 * HOUR, 24 * HOUR],
  /** A token refused right after a new sign-in: one new try after 1 h, 6 h, then every 24 h. */
  sessionRetry: [HOUR, 6 * HOUR, 24 * HOUR],
  /** Longest a pause read back from /data may still hold (a stop: its schedule's longest step). */
  persistedPauseMax: 6 * HOUR,
  persistedRetryMax: 24 * HOUR,
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  testCooldown: 30 * SECOND,
  /** A sign-in without code (which makes Leviton e-mail one) is started by the button at most once a minute. */
  codeCooldown: MINUTE,
};
