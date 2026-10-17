// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail nor the password:
//   - a random salt made once (for the fingerprint below);
//   - the token of the session (its user id, its end), with the account it
//     belongs to (a hash of the e-mail), so a restart does not sign in again;
//   - the accounts (hashes of the e-mail) that asked for a verification code:
//     they are never signed in again without a click (each sign-in e-mails a
//     code), and when the button last started a sign-in;
//   - the end of a 429, "too many attempts" or 403 pause (kept across restarts
//     and account changes);
//   - a stop on refused credentials and its spaced retries, tied to a salted
//     fingerprint of the e-mail and password, so a restart does not retry what
//     Leviton refused, and a new password does.
// Every time read back is capped from now (a pause at 6 h, a retry at 24 h).
// The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/leviton-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

export const newSalt = () => randomBytes(16).toString('hex');

/** The salted fingerprint of the credentials a stop belongs to (16 hex digits). */
export const fingerprint = (salt, email, password) =>
  createHash('sha256')
    .update(`${salt}\n${email.trim().toLowerCase()}\n${password}`)
    .digest('hex')
    .slice(0, 16);

const time = (value) => (Number.isFinite(value) ? value : undefined);
const str = (value, max) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;
const ACCOUNT = /^[0-9a-f]{16}$/;

export const BLOCKS = new Set(['refused', 'login_rejected', 'session_refused']);
export const PAUSES = new Set(['rate', 'locked', 'forbidden']);

function session(raw) {
  if (
    !ACCOUNT.test(raw?.account ?? '') ||
    !str(raw.token, 4096) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(raw.userId ?? '')
  ) {
    return null;
  }
  return {
    account: raw.account,
    token: raw.token,
    userId: raw.userId,
    expiresAt: time(raw.expiresAt) ?? 0,
    renewAt: time(raw.renewAt) ?? 0,
  };
}

/** The persisted state, repaired; the pause and retry ends are capped from `now`. */
export function normalizeMemory(raw, now = Date.now()) {
  const capped = (value, max) => {
    const t = time(value);
    return t === undefined || t <= now ? undefined : Math.min(t, now + max);
  };
  const pause = raw?.pause;
  const until = capped(pause?.until, TIMINGS.persistedPauseMax);
  const block = raw?.block;
  return {
    salt: typeof raw?.salt === 'string' && /^[0-9a-f]{32}$/.test(raw.salt) ? raw.salt : null,
    session: session(raw?.session),
    twoFactor: Array.isArray(raw?.twoFactor)
      ? [...new Set(raw.twoFactor.filter((a) => ACCOUNT.test(a)))].slice(-LIMITS.twoFactorAccounts)
      : [],
    codeAt: time(raw?.codeAt) === undefined ? undefined : Math.min(raw.codeAt, now),
    pause: until !== undefined && PAUSES.has(pause.kind) ? { kind: pause.kind, until } : null,
    block:
      BLOCKS.has(block?.kind) && /^[0-9a-f]{16}$/.test(block?.fingerprint ?? '')
        ? {
            kind: block.kind,
            fingerprint: block.fingerprint,
            // No retry time: the stop waits for the user (an account asking for a code).
            retryAt:
              block.retryAt === null
                ? null
                : (capped(block.retryAt, TIMINGS.persistedRetryMax) ?? now),
            retries:
              Number.isInteger(block.retries) && block.retries >= 0
                ? Math.min(block.retries, 10)
                : 0,
            status:
              Number.isInteger(block.status) && block.status >= 100 && block.status <= 599
                ? block.status
                : undefined,
          }
        : null,
  };
}
