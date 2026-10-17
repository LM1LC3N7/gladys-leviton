// -----------------------------------------------------------------------------
// The My Leviton account: the sign-in (e-mail and password, plus the
// verification code when the account uses one), the token kept across cycles
// and restarts (a new sign-in only when it ends or is refused, never at every
// cycle), and the calls the integration makes. Ported from decora-wifi (MIT):
// `POST /Person/login`, the token sent as the `authorization` header, the
// residential permissions, accounts, residences and their `iotSwitches`, and
// `PUT /IotSwitches/<id>` with `power` / `brightness`. Every request goes
// through the transport of src/http.js.
// -----------------------------------------------------------------------------

import { API_ROOT, LIMITS, PATHS, TIMINGS, USER_AGENT } from './constants.js';
import { LevitonError, apiError, httpRequest, loginError, parseJson } from './http.js';

/** An id of the API (LoopBack numbers or strings) -> a string, else undefined. */
export const idOf = (value) => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : undefined;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The margin a token is renewed before it ends: a tenth of its life, 5 min to
 * 1 h, and never more than half of it (a short token is not renewed at once).
 */
const marginOf = (lifetime) =>
  Math.min(
    lifetime / 2,
    Math.min(TIMINGS.tokenMarginMax, Math.max(TIMINGS.tokenMarginMin, lifetime / 10)),
  );

/** A sign-in answer (`{ id, ttl, userId, user }`) -> the session kept (and persisted). */
export function sessionOf(json, now) {
  if (!isObject(json) || typeof json.id !== 'string' || json.id === '' || json.id.length > 4096) {
    throw new LevitonError('bad_response', 'the sign-in sent no token');
  }
  const userId = idOf(json.userId) ?? idOf(json.user?.id);
  if (!userId) {
    throw new LevitonError('bad_response', 'the sign-in sent no user id');
  }
  const ttl = Number(json.ttl);
  // LoopBack: ttl in seconds; -1 or nothing usable -> homebridge-myleviton's one hour.
  const lifetime =
    Number.isFinite(ttl) && ttl > 60
      ? Math.min(ttl * 1000, 365 * 86_400_000)
      : TIMINGS.tokenDefaultTtl;
  const expiresAt = now + lifetime;
  return { token: json.id, userId, expiresAt, renewAt: expiresAt - marginOf(lifetime) };
}

export class LevitonClient {
  constructor({ transport = httpRequest, now = Date.now, onChange, onLogin } = {}) {
    this.transport = transport;
    this.now = now;
    /** Called after the session changed (persist it; never throws). */
    this.onChange = onChange;
    /** Called after a sign-in accepted, with `{ code }` (whether a code was sent). */
    this.onLogin = onLogin;
    this.email = '';
    this.password = '';
    /** { token, userId, expiresAt, renewAt } | null */
    this.session = null;
    this.authenticating = undefined;
    /** One sign-in per cycle at most (beginCycle resets it). */
    this.relogged = false;
    /** Per-request timeout; undefined = the transport's default (shorter for the buttons). */
    this.timeout = undefined;
  }

  configure({ email, password, session = null }) {
    this.email = email;
    this.password = password;
    this.session =
      session && typeof session.token === 'string' && idOf(session.userId) ? { ...session } : null;
    this.relogged = false;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  beginCycle() {
    this.relogged = false;
  }

  async changed() {
    try {
      await this.onChange?.();
    } catch {
      // Persisting is best effort: the session still works in memory.
    }
  }

  options(timeout) {
    const value = timeout ?? this.timeout;
    return value === undefined ? {} : { timeout: value };
  }

  /** One request with a JSON body (or none); the answer whatever its status. */
  send(method, path, { payload, token, timeout, onSent, sendWithin } = {}) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    return this.transport(`${API_ROOT}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(token ? { authorization: token } : {}),
        ...(body === undefined
          ? {}
          : {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': Buffer.byteLength(body),
            }),
      },
      body,
      maxBytes: LIMITS.responseBytes,
      onSent,
      ...(sendWithin === undefined ? {} : { sendWithin }),
      ...this.options(timeout),
    });
  }

  // --- Sign-in -------------------------------------------------------------------

  /** One sign-in at a time: a second caller joins the running one. */
  single(job) {
    if (!this.authenticating) {
      this.authenticating = job().finally(() => {
        this.authenticating = undefined;
      });
    }
    return this.authenticating;
  }

  /**
   * Signs in with the e-mail and the password (and `code`, the verification
   * code, only when a button sends it). Never more than one at a time.
   */
  login({ code, timeout } = {}) {
    if (!this.hasCredentials) {
      return Promise.reject(new LevitonError('no_credentials', 'no e-mail or password'));
    }
    return this.single(() => this.doLogin(code, timeout));
  }

  async doLogin(code, timeout) {
    const { email, password } = this;
    const payload = { email, password, ...(code ? { code } : {}) };
    const answer = await this.send('POST', PATHS.login, { payload, timeout });
    if (this.email !== email || this.password !== password) {
      throw new LevitonError('network', 'the account changed during the sign-in');
    }
    const error = loginError(answer, { withCode: Boolean(code), now: this.now() });
    if (error) {
      throw error;
    }
    this.session = sessionOf(parseJson(answer.body), this.now());
    await this.changed();
    try {
      await this.onLogin?.({ code: Boolean(code) });
    } catch {
      // Best effort, as persisting.
    }
    return this.session;
  }

  /** Forgets the session (refused by Leviton): the next cycle signs in again, if it may. */
  async drop() {
    if (this.session) {
      this.session = null;
      await this.changed();
    }
  }

  /**
   * A token to use. Resolves true when it was obtained now. A new sign-in only
   * when there is none or it is about to end, once per cycle, and only when
   * `allowLogin` (never from a command, never for an account that asks for a
   * code: that one keeps its token until Leviton refuses it).
   */
  async ensureToken({ allowLogin = true, timeout } = {}) {
    if (this.authenticating) {
      await this.authenticating.catch(() => {});
    }
    if (this.session && (!allowLogin || this.now() < this.session.renewAt)) {
      return false;
    }
    if (!allowLogin) {
      throw new LevitonError('unauthorized', 'not signed in to My Leviton', { notSent: true });
    }
    if (this.relogged) {
      throw new LevitonError('session_refused', 'the session was refused after a new sign-in');
    }
    this.relogged = true;
    await this.login({ timeout });
    return true;
  }

  // --- API -------------------------------------------------------------------------

  async apiSend(method, path, { payload, timeout, onSent, sendWithin } = {}) {
    const answer = await this.send(method, path, {
      payload,
      token: this.session?.token,
      timeout,
      onSent,
      sendWithin,
    });
    const error = apiError(answer, { now: this.now() });
    if (error) {
      throw error;
    }
    return parseJson(answer.body);
  }

  /**
   * An authenticated read. A refused token (401; a 403 too, as decora-wifi
   * treats it, when a new sign-in is allowed) is dropped, and the read done
   * once more after one new sign-in; refused again, or refused right after a
   * sign-in, it is `session_refused` (or `forbidden` for a 403).
   *
   * `retryAuth: false` (one residence among others): a 401/403 comes back as
   * is, the session kept; the caller decides whether the token is the cause.
   */
  async read(path, { allowLogin = true, timeout, retryAuth = true } = {}) {
    const fresh = await this.ensureToken({ allowLogin, timeout });
    try {
      return await this.apiSend('GET', path, { timeout });
    } catch (err) {
      const retry = err.kind === 'unauthorized' || (err.kind === 'forbidden' && allowLogin);
      if (!retry || !retryAuth) {
        throw err;
      }
      if (fresh) {
        throw this.refusedAgain(err);
      }
      await this.drop();
      if (!allowLogin) {
        throw err;
      }
    }
    await this.ensureToken({ allowLogin, timeout });
    try {
      return await this.apiSend('GET', path, { timeout });
    } catch (err) {
      throw err.kind === 'unauthorized' || err.kind === 'forbidden' ? this.refusedAgain(err) : err;
    }
  }

  refusedAgain(err) {
    if (err.kind === 'forbidden') {
      return err;
    }
    return new LevitonError('session_refused', 'the token was refused right after a sign-in', {
      status: err.status,
    });
  }

  /**
   * A command: sent once, never retried (a retry could act twice), never with
   * a new sign-in, never while a sign-in runs (it would leave late), never
   * after `sendWithin` ms (destroyed and refused unsent). A refused token is
   * forgotten for the next cycle.
   */
  async command(deviceId, payload, { timeout, onSent, sendWithin } = {}) {
    if (this.authenticating) {
      throw new LevitonError('timeout', 'a sign-in is running', { notSent: true });
    }
    await this.ensureToken({ allowLogin: false });
    try {
      return await this.apiSend('PUT', PATHS.switch(deviceId), {
        payload,
        timeout,
        onSent,
        sendWithin,
      });
    } catch (err) {
      if (err.kind === 'unauthorized') {
        await this.drop();
      }
      throw err;
    }
  }

  /**
   * The residences of the account: through the residential permissions, each
   * one a residential account (its residences) or a residence itself
   * (decora-wifi's cli-test.py).
   */
  async residences(options = {}) {
    // The user id comes with the session: sign in first when there is none.
    await this.ensureToken(options);
    const permissions = await this.read(PATHS.permissions(this.session.userId), options);
    if (!Array.isArray(permissions)) {
      throw new LevitonError('bad_response', 'Leviton sent no residential permissions');
    }
    const ids = new Set();
    for (const permission of permissions.slice(0, 50)) {
      if (!isObject(permission) || ids.size >= LIMITS.residences) {
        continue;
      }
      // A permission may hold a residence, a residential account, or both.
      const residence = idOf(permission.residenceId);
      if (residence) {
        ids.add(residence);
      }
      const account = idOf(permission.residentialAccountId);
      if (!account) {
        continue;
      }
      const list = await this.read(PATHS.residences(account), options);
      if (!Array.isArray(list)) {
        throw new LevitonError('bad_response', 'Leviton sent no residences');
      }
      for (const entry of list) {
        const rid = idOf(entry?.id);
        if (rid && ids.size < LIMITS.residences) {
          ids.add(rid);
        }
      }
    }
    return [...ids];
  }

  /** The devices of one residence, with their state (one request). */
  async switches(residenceId, options = {}) {
    const list = await this.read(PATHS.switches(residenceId), options);
    if (!Array.isArray(list)) {
      throw new LevitonError('bad_response', 'Leviton sent no device list');
    }
    return list;
  }

  /** One device, read again after a command (never a new sign-in). */
  async switch(deviceId, options = {}) {
    const json = await this.read(PATHS.switch(deviceId), { ...options, allowLogin: false });
    if (!isObject(json)) {
      throw new LevitonError('bad_response', 'Leviton sent no device');
    }
    return json;
  }
}
