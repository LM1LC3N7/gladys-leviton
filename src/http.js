// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to my.leviton.com, and the errors
// they end with. The body read is bounded, the promise settles once, redirects
// are never followed (a login replayed elsewhere would carry the password),
// and nothing secret nor any free text of an answer goes into an error.
// -----------------------------------------------------------------------------

import https from 'node:https';
import http from 'node:http';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed My Leviton call. `kind`:
 * - `no_credentials`: no e-mail or password (never sent);
 * - `refused`: the sign-in refused the e-mail or the password (401);
 * - `two_factor`: the account uses the verification code (406 "Requires code");
 * - `code_refused`: the code was refused (408 "Invalid code", or 406 again);
 * - `locked`: "Too many failed attempts" (403 of the sign-in);
 * - `login_rejected`: any other refusal of the sign-in (the API changed);
 * - `unauthorized`: the API refused the token (401);
 * - `forbidden`: a 403 of the API;
 * - `session_refused`: the token was refused right after a new sign-in;
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx; `network`, `timeout`: no answer (`notSent`: it never left);
 * - `bad_response`, `size`: not the expected answer; `http`: any other status.
 */
export class LevitonError extends Error {
  constructor(kind, message, { status, retryAfter, code, notSent } = {}) {
    super(message);
    this.name = 'LevitonError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
    this.notSent = Boolean(notSent);
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> LevitonError (never the request: the sign-in carries the password). */
export function networkError(err, notSent = false) {
  if (err instanceof LevitonError) {
    return err;
  }
  return new LevitonError('network', NETWORK_REASONS[err?.code] ?? 'network error', { notSent });
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof LevitonError) {
    const details = [err.code, err.status ? `HTTP ${err.status}` : undefined].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'unexpected error';
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status.
 * `onSent` is called once the request has fully left (a command must know
 * whether it was sent).
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
    onSent,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    let sent = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new LevitonError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    req.on('finish', () => {
      sent = true;
      onSent?.();
    });
    timer = setTimeout(
      () => {
        settle(
          reject,
          new LevitonError('timeout', `no answer within ${Math.round(timeout / 1000)} s`, {
            notSent: !sent,
          }),
        );
        req.destroy();
      },
      Math.max(1, timeout),
    );
    req.on('error', (err) => settle(reject, networkError(err, !sent)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** The JSON of a body, `undefined` when empty; `bad_response` when it is not JSON. */
export function parseJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new LevitonError('bad_response', 'Leviton sent an answer that is not JSON');
  }
}

/**
 * The LoopBack error envelope of an answer (`{ error: { statusCode, name,
 * message, code } }`, schmittx's parse_response): the message is only matched,
 * never logged; the code is kept when it is a short upper-case word.
 */
export function envelopeOf(body) {
  let json;
  try {
    json = parseJson(body);
  } catch {
    return {};
  }
  const error = json && typeof json === 'object' ? json.error : undefined;
  if (!error || typeof error !== 'object') {
    return {};
  }
  const text = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
  const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(error.code);
  return {
    message: text(error.message),
    name: text(error.name),
    code: code ? error.code : undefined,
  };
}

/** The transient errors shared by every call: 429, 5xx. Undefined otherwise. */
export function transientError({ status, headers = {} }, now) {
  if (status === 429) {
    return new LevitonError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status >= 500) {
    return new LevitonError('unavailable', 'My Leviton is unavailable', { status });
  }
  return undefined;
}

const TWO_FACTOR = /two.?factor|requires? (a )?code/i;
const TOO_MANY = /too many/i;

/**
 * The error of a sign-in answer, or undefined when it is a success. schmittx:
 * 401 "Login Failed", 403 "Too many failed attempts", 406 "Person uses two
 * factor authentication. Requires code.", 408 "Error: Invalid code".
 */
export function loginError(answer, { withCode = false, now } = {}) {
  const { status } = answer;
  if (status >= 200 && status < 300) {
    return undefined;
  }
  const transient = transientError(answer, now);
  if (transient) {
    return transient;
  }
  const { message, code } = envelopeOf(answer.body);
  if (status === 401) {
    return new LevitonError('refused', 'e-mail or password refused', { status, code });
  }
  if (status === 403) {
    return new LevitonError(
      'locked',
      TOO_MANY.test(message) ? 'too many failed sign-ins' : 'sign-in refused (HTTP 403)',
      { status, code },
    );
  }
  if (status === 408 || (status === 406 && withCode)) {
    return new LevitonError('code_refused', 'verification code refused', { status, code });
  }
  if (status === 406) {
    // The envelope says why; a 406 of the sign-in has no other known meaning.
    return new LevitonError(
      'two_factor',
      TWO_FACTOR.test(message) ? 'Leviton asks for the verification code' : 'Leviton asks for more',
      { status, code },
    );
  }
  return new LevitonError('login_rejected', 'sign-in request rejected', { status, code });
}

/** The error of an API answer (reads and commands), or undefined when it is a success. */
export function apiError(answer, { now } = {}) {
  const { status } = answer;
  if (status >= 200 && status < 300) {
    return undefined;
  }
  const transient = transientError(answer, now);
  if (transient) {
    return transient;
  }
  const { code } = envelopeOf(answer.body);
  if (status === 401) {
    return new LevitonError('unauthorized', 'token refused', { status, code });
  }
  if (status === 403) {
    return new LevitonError('forbidden', 'request refused', { status, code });
  }
  return new LevitonError('http', 'request failed', { status, code });
}
