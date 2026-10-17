// -----------------------------------------------------------------------------
// The integration: the My Leviton account (e-mail, password, and the code
// Leviton e-mails when the account uses one), one read of the devices of each
// residence per cycle (30 to 60 s), the Gladys devices and their states, the
// commands (one at a time per device, refused before they are sent when they
// cannot be answered within Gladys' 5 s, the device read again after), the
// transport badges and the configuration buttons. index.js only wires the SDK
// handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { LevitonClient } from './client.js';
import { normalizeConfig } from './config.js';
import { LIMITS, TIMINGS } from './constants.js';
import { buildDevice, deviceIds, deviceStates, planOf } from './devices.js';
import { LevitonError, errorReason } from './http.js';
import { ERRORS, T, age, join, word } from './i18n.js';
import { readDevices, withAnswer } from './model.js';
import { StatePublisher } from './publisher.js';
import { BLOCKS, PAUSES, fileStore, fingerprint, newSalt, normalizeMemory } from './store.js';

/** Errors My Leviton did not answer usefully for: the account is unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** Errors that end a cycle at once, even when an older list of residences is known. */
const FATAL = new Set([
  'refused',
  'login_rejected',
  'two_factor',
  'session_refused',
  'unauthorized',
  'rate_limited',
  'locked',
  'forbidden',
  'no_credentials',
]);
/**
 * Errors of the read of one residence that leave the others readable (the
 * residence keeps its last devices, marked unreachable). The rest ends the
 * cycle at once.
 */
const PER_RESIDENCE = new Set([
  'unauthorized',
  'forbidden',
  'http',
  'unavailable',
  'network',
  'timeout',
  'bad_response',
  'size',
]);
/** The stops of a refusal, with the spaced new tries of each. */
const SCHEDULES = {
  refused: TIMINGS.refusedRetry,
  login_rejected: TIMINGS.refusedRetry,
  session_refused: TIMINGS.sessionRetry,
};
/** The fields of a Gladys feature that a publication carries. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class LevitonApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'leviton' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new LevitonClient({
      transport,
      now,
      onChange: () => this.persist(),
      onLogin: (info) => this.loggedIn(info),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** The residences of the account, and when they were read. */
    this.residences = undefined;
    this.topologyAt = -Infinity;
    /** The last read: Leviton id -> device (src/model.js). */
    this.devices = new Map();
    /** Leviton id -> plan (src/devices.js). */
    this.plans = new Map();
    /** feature external id -> { deviceId, spec } */
    this.writers = new Map();
    /** Every device published in this run, by external id: a publication never shrinks. */
    this.known = new Map();
    /** feature external id -> { expected, until }: a commanded value no read has confirmed yet. */
    this.holds = new Map();
    /** Leviton id -> the tail of its command queue. */
    this.queues = new Map();
    /** Leviton id -> the timer of its read after a command. */
    this.rereads = new Map();
    this.readCount = 0;
    this.published = undefined;
    this.badges = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    /** undefined | 'refused' | 'login_rejected' | 'session_refused' | 'two_factor' */
    this.blocked = undefined;
    /** The next try of a stop (null: none, the user acts), its count, the HTTP status. */
    this.retryAt = null;
    this.retries = 0;
    this.blockStatus = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
    /** 'rate' (429), 'locked' (too many sign-ins), 'forbidden' (403): every path; or 'backoff'. */
    this.pauseKind = undefined;
    this.lastTestAt = -Infinity;
    this.started = false;
    this.lastStatus = undefined;
    /** A click (a saved configuration, a button): the next cycle may sign in once. */
    this.grant = false;
    /** Residence id -> its last device list (kept when a later read of it fails). */
    this.lists = new Map();
    /** Ids of the devices of a residence whose last read failed (badge unreachable). */
    this.stale = new Set();
    /** The account `known` belongs to. */
    this.knownAccount = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `grant`: started by a click (a saved configuration), so it may sign in once. */
  async start(raw = {}, { grant = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    if (this.knownAccount !== this.config.account) {
      // Another account: the devices of the previous one are not published again.
      this.known = new Map();
      this.knownAccount = this.config.account;
    }
    this.grant = grant;
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (!this.memory.salt) {
      this.memory.salt = newSalt();
      await this.saveMemory();
    }
    // A pause of every path survives a restart and a change of account.
    const pause = this.memory.pause;
    if (pause && pause.until > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
    }
    const { email, password, account } = this.config;
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.configure({ email, password, session });
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    // A stop on these very credentials survives a restart, with its next try.
    const block = this.memory.block;
    if (block && block.fingerprint === this.fingerprint) {
      this.blocked = block.kind;
      this.retryAt = block.retryAt;
      this.retries = block.retries;
      this.blockStatus = block.status;
      await this.setStatus(false, this.blockMessage());
      this.scheduleNext();
      return;
    }
    if (!this.client.session && !this.mayLogin) {
      // Only an account whose sign-in without code was accepted is signed in
      // without a click: any other one could get a code e-mailed.
      await this.loginRequired();
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    for (const timer of this.rereads.values()) {
      this.timers.clearTimeout(timer);
    }
    this.rereads = new Map();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Forgets the account and the failures: a new account, or a restart. A pause of every path stays. */
  reset() {
    this.residences = undefined;
    this.topologyAt = -Infinity;
    this.devices = new Map();
    this.plans = new Map();
    this.writers = new Map();
    this.holds = new Map();
    this.readCount = 0;
    this.published = undefined;
    this.badges = new Map();
    this.lists = new Map();
    this.stale = new Set();
    this.grant = false;
    this.blocked = undefined;
    this.retryAt = null;
    this.retries = 0;
    this.blockStatus = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    if (!PAUSES.has(this.pauseKind) || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
  }

  get fingerprint() {
    return fingerprint(this.memory.salt ?? '', this.config.email, this.config.password);
  }

  /** Whether this account asked for a verification code (for the message). */
  get twoFactor() {
    return this.config.account !== '' && this.memory.twoFactor.includes(this.config.account);
  }

  /** Whether a sign-in without code of this account was accepted (and no code asked since). */
  get noCode() {
    return this.config.account !== '' && this.memory.noCode.includes(this.config.account);
  }

  /** A sign-in may start without a click: only for an account known to need no code. */
  get mayLogin() {
    return this.noCode || this.grant;
  }

  async mark(list, on) {
    const { account } = this.config;
    const next = this.memory[list].filter((a) => a !== account);
    if (on) {
      next.push(account);
    }
    const capped = next.slice(-LIMITS.twoFactorAccounts);
    if (JSON.stringify(capped) !== JSON.stringify(this.memory[list])) {
      this.memory[list] = capped;
      await this.saveMemory();
    }
  }

  markTwoFactor(on) {
    return this.mark('twoFactor', on);
  }

  /** A sign-in accepted: without code, the account may be signed in without a click from now on. */
  async loggedIn({ code }) {
    if (code) {
      await this.markTwoFactor(true);
      return;
    }
    await this.mark('noCode', true);
    await this.markTwoFactor(false);
  }

  /** No session and no sign-in allowed without a click: stop, no timer. */
  async loginRequired() {
    this.blocked = this.twoFactor ? 'two_factor' : 'login_required';
    this.retryAt = null;
    this.clearTimer();
    await this.setStatus(false, this.blockMessage());
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges, states). The pauses, the stops and the session stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    // A reconnection is not a click: it never signs in by itself.
    await this.configUpdated(raw, { click: false });
    this.published = undefined;
    this.badges = new Map();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
  }

  /**
   * New credentials restart; a new interval reschedules; a new language
   * renames. Saved by the user (`click`, the SDK handler): it counts as a
   * click, so a stop waiting for one is lifted and one sign-in may start; the
   * wait for a code stays (its own buttons).
   */
  async configUpdated(raw = {}, { click = true } = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.email !== previous.email || next.password !== previous.password) {
      return this.start(raw, { grant: click });
    }
    this.config = next;
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
    if (
      click &&
      this.client.hasCredentials &&
      (this.blocked === 'login_required' || BLOCKS.has(this.blocked))
    ) {
      this.blocked = undefined;
      this.retryAt = null;
      await this.saveBlock();
      this.grant = true;
      await this.tick();
      return;
    }
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The session of the client, with its account. */
  async persist() {
    const { session } = this.client;
    this.memory.session = session ? { account: this.config.account, ...session } : null;
    await this.saveMemory();
  }

  /** Keeps the current stop (or none) in /data, tied to the credentials. */
  async saveBlock() {
    const block = BLOCKS.has(this.blocked)
      ? {
          kind: this.blocked,
          fingerprint: this.fingerprint,
          retryAt: this.retryAt,
          retries: this.retries,
          ...(this.blockStatus ? { status: this.blockStatus } : {}),
        }
      : null;
    if (JSON.stringify(block) !== JSON.stringify(this.memory.block ?? null)) {
      this.memory.block = block;
      await this.saveMemory();
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The next read: at the stop's next try, after the pause, else the interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.client.hasCredentials) {
      return;
    }
    const now = this.now();
    let delay;
    if (this.blocked) {
      if (this.blocked === 'two_factor' || this.retryAt === null) {
        return;
      }
      delay = Math.max(this.retryAt, this.pausedUntil) - now;
    } else if (now < this.pausedUntil) {
      delay = this.pausedUntil - now;
    } else {
      delay = this.config.pollInterval * 1000;
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Leviton refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for a button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    const now = this.now();
    // A click allows one sign-in, for the cycle it starts only: consumed here,
    // even when this run waits (a pause, a stop), so a click during a pause
    // never signs in when the pause ends.
    const granted = this.grant;
    this.grant = false;
    if (!this.client.hasCredentials) {
      return;
    }
    if (BLOCKS.has(this.blocked) && this.retryAt !== null && now >= this.retryAt) {
      // The spaced new try of a stop (its count goes on).
      this.logger.info('Leviton: trying again after a stop');
      this.blocked = undefined;
    }
    if (this.blocked || now < this.pausedUntil) {
      const paused = this.pauseMessage();
      if (granted && paused && !this.blocked) {
        // The click is spent on a pause: say why nothing happens.
        await this.setStatus(this.connectedOnce, paused);
      }
      this.scheduleNext();
      return;
    }
    // A sign-in without a click only for an account known to need no code;
    // a click allows one, for this cycle only.
    const options = { allowLogin: this.noCode || granted };
    if (!this.client.session && !options.allowLogin) {
      await this.loginRequired();
      // The badges follow the stop (unreachable).
      await this.publishBadges();
      return;
    }
    this.client.beginCycle();
    this.client.timeout = quick ? TIMINGS.quickTimeout : undefined;
    try {
      if (!this.residences || now - this.topologyAt >= TIMINGS.topologyInterval) {
        try {
          this.residences = await this.client.residences(options);
          this.topologyAt = this.now();
        } catch (err) {
          if (!this.residences || FATAL.has(err.kind)) {
            throw err;
          }
          // The residences known keep working; they are read again next cycle.
          this.logger.info(`Leviton residences not read again: ${errorReason(err)}`);
        }
      }
      const lists = await this.readResidences(options);
      if (generation !== this.generation) {
        return;
      }
      await this.apply(lists);
      this.failures = 0;
      this.retries = 0;
      this.blockStatus = undefined;
      this.offline = false;
      this.connectedOnce = true;
      if (this.pauseKind === 'backoff') {
        this.pauseKind = undefined;
      }
      await this.saveBlock();
      await this.setStatus(true, T.connected(this.readCount, this.plans.size));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    } finally {
      this.client.timeout = undefined;
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * The devices of every residence, each read on its own: one that fails keeps
   * its last devices (badge unreachable) and the others go on. Only when every
   * residence fails is a 401/403 taken as a refused token (dropped, one new
   * sign-in, the reads again), or the error the cycle's.
   */
  async readResidences(options) {
    const read = async (retryAuth) => {
      const lists = new Map();
      const failures = new Map();
      for (const residence of this.residences) {
        try {
          lists.set(residence, await this.client.switches(residence, { ...options, retryAuth }));
        } catch (err) {
          const own =
            err instanceof LevitonError &&
            PER_RESIDENCE.has(err.kind) &&
            !(err.kind === 'unauthorized' && err.notSent);
          if (!own || retryAuth) {
            throw err;
          }
          failures.set(residence, err);
        }
      }
      return { lists, failures };
    };
    let { lists, failures } = await read(false);
    if (failures.size > 0 && lists.size === 0) {
      const errors = [...failures.values()];
      if (!errors.some((e) => e.kind === 'unauthorized' || e.kind === 'forbidden')) {
        throw errors[0];
      }
      ({ lists, failures } = await read(true));
    }
    for (const residence of [...this.lists.keys()]) {
      if (!this.residences.includes(residence)) {
        this.lists.delete(residence);
      }
    }
    this.stale = new Set();
    for (const [residence, list] of lists) {
      this.lists.set(residence, list);
    }
    for (const [residence, err] of failures) {
      this.logger.info(`Leviton: one residence not read (${errorReason(err)})`);
      for (const raw of this.lists.get(residence) ?? []) {
        const id = readDevices([[raw]])
          .keys()
          .next().value;
        if (id) {
          this.stale.add(id);
        }
      }
    }
    return [...this.residences].map((r) => this.lists.get(r)).filter(Boolean);
  }

  /** A pause of every path (429, too many sign-ins, 403), kept in /data. */
  async pause(err) {
    let wait;
    if (err.kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pauseKind = 'rate';
    } else if (err.kind === 'locked') {
      wait = TIMINGS.lockedPause;
      this.pauseKind = 'locked';
    } else {
      wait = TIMINGS.forbiddenPause;
      this.pauseKind = 'forbidden';
      this.offline = true;
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { kind: this.pauseKind, until: this.pausedUntil };
    await this.saveMemory();
    return wait;
  }

  blockMessage() {
    const wait = this.retryAt === null ? null : age(Math.max(0, this.retryAt - this.now()));
    switch (this.blocked) {
      case 'refused':
        return T.refused(wait);
      case 'login_rejected':
        return T.loginRejected(this.blockStatus ?? '?', wait);
      case 'session_refused':
        return wait ? T.sessionRefused(wait) : T.sessionRefusedWaiting;
      case 'login_required':
        return T.loginRequired;
      default:
        return T.twoFactor;
    }
  }

  /** The account asks for a code: stop, until a button gets a session. */
  async needCode() {
    await this.mark('noCode', false);
    await this.markTwoFactor(true);
    this.blocked = 'two_factor';
    this.retryAt = null;
    this.clearTimer();
    await this.setStatus(false, T.twoFactor);
  }

  async failed(err) {
    const reason = errorReason(err);
    if (err.kind === 'no_credentials') {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    if (err.kind === 'two_factor') {
      // The account uses a code: never signed in again without a click.
      this.logger.warn(`Leviton stopped: ${reason}`);
      await this.needCode();
      return;
    }
    if (err.kind === 'unauthorized') {
      // The token refused and no sign-in allowed without a click.
      this.logger.warn(`Leviton stopped: ${reason}`);
      await this.loginRequired();
      return;
    }
    const schedule = SCHEDULES[err.kind];
    if (schedule) {
      // Never signed in again in a loop: refusals may lock the account. Only
      // an account known to need no code is tried again by itself (a new try
      // could e-mail a code); any other one waits for a click.
      const wait = this.noCode ? schedule[Math.min(this.retries, schedule.length - 1)] : null;
      this.blocked = err.kind;
      this.retryAt = wait === null ? null : this.now() + wait;
      this.retries += 1;
      this.blockStatus = err.status;
      this.clearTimer();
      await this.saveBlock();
      this.logger.warn(
        `Leviton stopped: ${reason}${wait === null ? '' : `; one new try in ${Math.round(wait / 60_000)} min`}`,
      );
      await this.setStatus(false, this.blockMessage());
      return;
    }
    let wait;
    let message;
    if (err.kind === 'rate_limited' || err.kind === 'locked' || err.kind === 'forbidden') {
      wait = await this.pause(err);
      message = this.pauseMessage();
    } else {
      // Never read again sooner than the interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.offline = OFFLINE.has(err.kind) || this.offline;
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.unreachable(reason, age(wait));
    }
    this.failures += 1;
    const connected = err.kind === 'rate_limited' && this.connectedOnce;
    await this.setStatus(connected, message);
    this.logger.warn(`Leviton: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  async apply(lists) {
    const devices = readDevices(lists);
    this.readCount = devices.size;
    this.devices = devices;
    this.rebuild();
    await this.publishDevices();
    this.queueStates();
  }

  /** The plans and the writers of the last read. */
  rebuild() {
    this.plans = new Map();
    this.writers = new Map();
    /** The features of a model shown read only (not in the lists). */
    this.readOnly = new Set();
    for (const device of this.devices.values()) {
      const plan = planOf(device);
      if (!plan) {
        continue;
      }
      this.plans.set(device.id, plan);
      const ids = deviceIds(this.gladys, device.id);
      for (const spec of plan.specs) {
        if (spec.write) {
          this.writers.set(ids.feature(spec.key), { deviceId: device.id, spec });
        } else if (plan.readOnly) {
          this.readOnly.add(ids.feature(spec.key));
        }
      }
    }
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevices() {
    return new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * The devices of the last read, merged so that nothing ever disappears: a
   * created device keeps its features as Gladys has them (types and units are
   * fixed at creation), plus any new one; a device or a feature seen earlier
   * in this run stays published.
   */
  async publishDevices() {
    const created = this.createdDevices();
    for (const device of this.devices.values()) {
      const plan = this.plans.get(device.id);
      if (!plan) {
        continue;
      }
      const fresh = buildDevice(this.gladys, device, plan, this.config.language);
      const previous = this.known.get(fresh.external_id);
      const mine = created.get(fresh.external_id);
      const features = new Map();
      for (const f of mine?.features ?? []) {
        features.set(
          f.external_id,
          Object.fromEntries(
            FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
          ),
        );
      }
      for (const f of [...(previous?.features ?? []), ...fresh.features]) {
        if (!features.has(f.external_id)) {
          features.set(f.external_id, f);
        }
      }
      if (!previous && this.known.size >= LIMITS.devices) {
        continue;
      }
      this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    }
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (list.length === 0 || json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** A commanded value waiting for its confirmation hides an older read one. */
  held(featureId, state) {
    const hold = this.holds.get(featureId);
    if (!hold) {
      return false;
    }
    if (this.now() >= hold.until || state === hold.expected) {
      this.holds.delete(featureId);
      return false;
    }
    return true;
  }

  queueStates(created = this.createdFeatures(), only) {
    for (const [id, plan] of this.plans) {
      // A device of a residence not read this cycle: its old values are not
      // queued again (nor sent again by the 30 min heartbeat).
      if ((only && id !== only) || this.stale.has(id)) {
        continue;
      }
      for (const { device_feature_external_id: featureId, state } of deviceStates(
        this.gladys,
        this.devices.get(id),
        plan,
      )) {
        if (created.has(featureId) && !this.held(featureId, state)) {
          this.publisher.push(featureId, { state });
        }
      }
    }
  }

  /** One badge per created device: cloud, or unreachable (stopped, unreachable, offline for Leviton). */
  async publishBadges() {
    const entries = [];
    const sources = new Map(
      [...this.devices.values()].map((d) => [deviceIds(this.gladys, d.id).device, d]),
    );
    for (const device of this.gladys.devices ?? []) {
      if (!this.known.has(device.external_id)) {
        continue;
      }
      const source = sources.get(device.external_id);
      const unreachable =
        this.blocked ||
        this.offline ||
        !source ||
        source.online === false ||
        this.stale.has(source.id);
      const transport = unreachable ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
      if (this.badges.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.badges.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        this.logger.warn(`Transport badges failed: ${err.message}`);
      }
    }
  }

  async deviceCreated(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
    }
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last read (no extra request). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  error(text) {
    return new Error(word(text, this.config.language));
  }

  async setValue(device, feature, value) {
    const received = this.now();
    const writer = this.writers.get(feature?.external_id);
    if (!writer) {
      throw this.error(this.readOnly?.has(feature?.external_id) ? ERRORS.readOnly : ERRORS.unknown);
    }
    const number = Number(value);
    if (value === null || value === '' || !Number.isFinite(number)) {
      throw this.error(ERRORS.invalidValue);
    }
    if (this.blocked || !this.client.hasCredentials || !this.client.session) {
      throw this.error(ERRORS.blocked);
    }
    const paused = this.commandPause();
    if (paused) {
      throw this.error(paused);
    }
    const { deviceId, spec } = writer;
    const generation = this.generation;
    await this.serial(
      deviceId,
      () => this.command(deviceId, spec, number, received, generation),
      received + TIMINGS.commandSendBy,
    );
  }

  /** The message of a pause that holds the commands (each kind its own), else undefined. */
  commandPause() {
    if (this.now() >= this.pausedUntil || this.pauseKind === 'backoff') {
      return undefined;
    }
    return this.pauseMessage() ?? ERRORS.paused;
  }

  /**
   * One command at a time per device: each waits for the previous one,
   * including a request still finishing in the background, but never past
   * `sendBy`: still waiting then, it is refused unsent (Gladys gets its answer
   * within its 5 s).
   */
  serial(deviceId, job, sendBy) {
    const previous = this.queues.get(deviceId) ?? Promise.resolve();
    let handle;
    const late = new Promise((resolve) => {
      handle = this.timers.setTimeout(() => resolve(false), Math.max(0, sendBy - this.now()));
    });
    const run = Promise.race([previous.then(() => true), late]).then((ready) => {
      this.timers.clearTimeout(handle);
      if (!ready) {
        throw this.error(ERRORS.late);
      }
      return job();
    });
    // The next command waits for the previous ones and this one (its background too).
    const tail = Promise.all([
      previous,
      run.then(
        (result) => result?.background,
        () => {},
      ),
    ]).then(() => undefined);
    this.queues.set(deviceId, tail);
    tail.finally(() => {
      if (this.queues.get(deviceId) === tail) {
        this.queues.delete(deviceId);
      }
    });
    return run.then(() => undefined);
  }

  /**
   * Builds the body, sends it once. Gladys waits 5 s: nothing is sent later
   * than 3 s after the click (refused unsent), and Gladys is answered at 4.3 s
   * at the latest; the request then finishes in the background, and its
   * promise is returned as `background` (the next command of the device waits
   * for it). The device is read again after.
   */
  async command(deviceId, spec, number, received, generation) {
    const sendBy = received + TIMINGS.commandSendBy;
    const device = this.devices.get(deviceId);
    if (!device || generation !== this.generation) {
      throw this.error(ERRORS.unknown);
    }
    if (device.online === false) {
      throw this.error(ERRORS.offline);
    }
    const payload = spec.write(number, device);
    if (payload.refuse) {
      throw this.error(ERRORS[payload.refuse]);
    }
    if (this.blocked) {
      throw this.error(ERRORS.blocked);
    }
    const paused = this.commandPause();
    if (paused) {
      throw this.error(paused);
    }
    if (sendBy - this.now() < 300 || this.client.authenticating) {
      // Too late, or a sign-in runs (the command would leave after it): unsent.
      throw this.error(ERRORS.late);
    }
    this.logger.info(`Leviton command: ${spec.key} of a ${device.kind}`);
    let sent = false;
    const request = this.client.command(deviceId, payload, {
      timeout: TIMINGS.requestTimeout,
      sendWithin: sendBy - this.now(),
      onSent: () => {
        sent = true;
      },
    });
    let handle;
    const ack = new Promise((resolve) => {
      handle = this.timers.setTimeout(
        () => resolve({ pending: true }),
        Math.max(0, received + TIMINGS.commandAck - this.now()),
      );
    });
    const outcome = await Promise.race([
      request.then(
        (answer) => ({ answer }),
        (err) => ({ err }),
      ),
      ack,
    ]);
    this.timers.clearTimeout(handle);
    if (outcome.pending && !sent) {
      // Never left (its send limit destroys it): Gladys hears it was not sent.
      request.catch(() => {});
      throw this.error(ERRORS.late);
    }
    if (outcome.pending) {
      // Sent, Leviton still at work: Gladys is answered now, the state follows.
      const background = request
        .then(
          (answer) => {
            if (generation === this.generation) {
              this.confirm(deviceId, payload, answer);
            }
          },
          async (err) => {
            this.logger.warn(`Leviton command ${spec.key} failed: ${errorReason(err)}`);
            if (generation === this.generation && err.kind === 'rate_limited') {
              await this.pause(err);
              await this.setStatus(this.connectedOnce, this.pauseMessage());
            }
          },
        )
        .finally(() => {
          if (generation === this.generation) {
            this.scheduleReread(deviceId);
          }
        });
      return { background };
    }
    if (outcome.err) {
      throw await this.commandFailure(outcome.err, deviceId);
    }
    this.confirm(deviceId, payload, outcome.answer);
    this.scheduleReread(deviceId);
    return {};
  }

  /**
   * What Leviton answers to the PUT (the device, decora-wifi's
   * update_attributes) becomes the state at once, else the values sent; held
   * 15 s against an older read. Published without making Gladys wait.
   */
  confirm(deviceId, payload, answer) {
    const before = this.devices.get(deviceId);
    const plan = this.plans.get(deviceId);
    if (!before || !plan) {
      return;
    }
    const source = isObject(answer) && 'power' in answer ? answer : payload;
    const after = withAnswer(before, source);
    this.devices.set(deviceId, after);
    const old = new Map(
      deviceStates(this.gladys, before, plan).map((s) => [s.device_feature_external_id, s.state]),
    );
    this.queueStates(undefined, deviceId);
    // Set after the confirmed values are queued: they are the expected ones.
    const until = this.now() + TIMINGS.commandHold;
    for (const { device_feature_external_id: id, state } of deviceStates(
      this.gladys,
      after,
      plan,
    )) {
      if (old.get(id) !== state) {
        this.holds.set(id, { expected: state, until });
      }
    }
    this.flush();
  }

  /** The device is read again shortly after a command (once, whatever the number of commands). */
  scheduleReread(deviceId) {
    const existing = this.rereads.get(deviceId);
    if (existing) {
      this.timers.clearTimeout(existing);
    }
    const generation = this.generation;
    this.rereads.set(
      deviceId,
      this.timers.setTimeout(() => {
        this.rereads.delete(deviceId);
        if (generation === this.generation) {
          this.reread(deviceId, generation).catch(() => {});
        }
      }, TIMINGS.rereadAfterCommand),
    );
  }

  async reread(deviceId, generation) {
    if (this.blocked || this.now() < this.pausedUntil || !this.client.session) {
      return;
    }
    try {
      const raw = await this.client.switch(deviceId);
      const device = this.devices.get(deviceId);
      if (!device || generation !== this.generation) {
        return;
      }
      this.devices.set(deviceId, withAnswer(device, raw));
      this.queueStates(undefined, deviceId);
      await this.flush();
      await this.publishBadges();
    } catch (err) {
      this.logger.info(`Leviton device not read again: ${errorReason(err)}`);
      if (err.kind === 'rate_limited' && generation === this.generation) {
        await this.pause(err);
        await this.setStatus(this.connectedOnce, this.pauseMessage());
      }
    }
  }

  async commandFailure(err, deviceId) {
    if (!(err instanceof LevitonError)) {
      return err;
    }
    const reason = errorReason(err);
    this.logger.warn(`Leviton command not done: ${reason}`);
    switch (err.kind) {
      case 'rate_limited':
        await this.pause(err);
        await this.setStatus(this.connectedOnce, this.pauseMessage());
        return this.error(this.pauseMessage() ?? ERRORS.paused);
      case 'unauthorized':
        // The token is forgotten: the next cycle signs in again (or asks for a code).
        return this.error(ERRORS.blocked);
      case 'timeout':
      case 'network':
        if (err.notSent) {
          return this.error(ERRORS.late);
        }
        this.scheduleReread(deviceId);
        return this.error(ERRORS.unsure(reason));
      case 'unavailable':
      case 'bad_response':
      case 'size':
        // Answered, but not as expected: the command may have been done.
        this.scheduleReread(deviceId);
        return this.error(ERRORS.unsure(reason));
      default:
        // A 403 of a command is that command refused, never a pause of everything.
        return this.error(ERRORS.refused(reason));
    }
  }

  // --- Configuration buttons ----------------------------------------------------

  /** A pause of every path holds for the buttons too. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    switch (this.pauseKind) {
      case 'rate':
        return T.rateLimited(age(left));
      case 'locked':
        return T.locked(age(left));
      case 'forbidden':
        return T.forbidden(age(left));
      default:
        return undefined;
    }
  }

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.blocked === 'two_factor' || (this.twoFactor && !this.client.session)) {
      return T.twoFactor;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // One read per click: the button is how a stopped account is tried again,
    // and a click may sign in once.
    this.blocked = undefined;
    this.retryAt = null;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    this.grant = true;
    await this.saveBlock();
    await this.tick({ quick: true });
    return this.lastMessage ?? T.noCredentials;
  }

  async codeFailure(err) {
    switch (err.kind) {
      case 'refused':
      case 'login_rejected':
        await this.failed(err);
        return this.blockMessage();
      case 'no_credentials':
        return T.noCredentials;
      case 'code_refused':
        return T.code.refused;
      case 'rate_limited':
      case 'locked':
      case 'forbidden':
        await this.failed(err);
        return this.pauseMessage();
      default:
        this.logger.warn(`Leviton verification: ${errorReason(err)}`);
        return T.code.failed(errorReason(err));
    }
  }

  /** The way back to a connection. */
  async signedIn() {
    this.blocked = undefined;
    this.retryAt = null;
    this.failures = 0;
    this.retries = 0;
    this.blockStatus = undefined;
    await this.saveBlock();
    await this.tick({ quick: true });
  }

  /** Checks shared by the two code buttons; a message when the button cannot run. */
  codeRefusal() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.client.session && !this.blocked) {
      // Connected: a new sign-in would only send a needless e-mail.
      return T.code.alreadyConnected;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.running) {
      return T.busy;
    }
    return undefined;
  }

  /** Step 1: a sign-in without code; Leviton e-mails one when the account uses it. */
  async requestCode() {
    const refusal = this.codeRefusal();
    if (refusal) {
      return refusal;
    }
    if (this.now() - (this.memory.codeAt ?? -Infinity) < TIMINGS.codeCooldown) {
      return T.code.cooldown;
    }
    this.memory.codeAt = this.now();
    await this.saveMemory();
    try {
      await this.client.login({ timeout: TIMINGS.quickTimeout });
    } catch (err) {
      if (err.kind === 'two_factor') {
        this.logger.info('Leviton verification code requested');
        await this.needCode();
        return T.code.sent;
      }
      return this.codeFailure(err);
    }
    // The account was marked "no code" by the sign-in (src/client.js onLogin).
    await this.signedIn();
    return T.code.notNeeded;
  }

  /** Step 2: the e-mailed code, sent with the e-mail and the password. */
  async verifyCode(fields) {
    if (!fields || typeof fields !== 'object' || !('code' in fields)) {
      return T.code.needsFields;
    }
    const code = String(fields.code ?? '').replace(/[\s-]/g, '');
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
      return T.code.badFormat;
    }
    const refusal = this.codeRefusal();
    if (refusal) {
      return refusal;
    }
    try {
      await this.client.login({ code, timeout: TIMINGS.quickTimeout });
    } catch (err) {
      return this.codeFailure(err);
    }
    this.logger.info('Leviton verification code accepted');
    await this.markTwoFactor(true);
    await this.signedIn();
    return T.code.verified;
  }
}
