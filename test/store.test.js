// -----------------------------------------------------------------------------
// What /data holds: repaired, capped when read back, never a secret of the
// configuration; the file written atomically with its 0600 mode.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR } from '../src/constants.js';
import { fileStore, fingerprint, newSalt, normalizeMemory } from '../src/store.js';

const NOW = 1_800_000_000_000;
const ACCOUNT = '0123456789abcdef';

test('a pause and a retry read back are capped from now; past ones are dropped', () => {
  const memory = normalizeMemory(
    {
      pause: { kind: 'rate', until: NOW + 100 * HOUR },
      block: { kind: 'refused', fingerprint: ACCOUNT, retryAt: NOW + 100 * HOUR, retries: 99 },
    },
    NOW,
  );
  assert.deepEqual(memory.pause, { kind: 'rate', until: NOW + 6 * HOUR });
  assert.equal(memory.block.retryAt, NOW + 24 * HOUR);
  assert.equal(memory.block.retries, 10);
  const past = normalizeMemory(
    {
      pause: { kind: 'locked', until: NOW - 1 },
      block: { kind: 'session_refused', fingerprint: ACCOUNT, retryAt: NOW - 1 },
    },
    NOW,
  );
  assert.equal(past.pause, null);
  assert.equal(past.block.retryAt, NOW, 'a past retry is due now');
  const waiting = normalizeMemory(
    { block: { kind: 'refused', fingerprint: ACCOUNT, retryAt: null } },
    NOW,
  );
  assert.equal(waiting.block.retryAt, null, 'a stop waiting for the user stays so');
});

test('anything malformed is dropped', () => {
  const memory = normalizeMemory(
    {
      salt: 'short',
      session: { account: ACCOUNT, token: '', userId: '1' },
      twoFactor: ['nope', ACCOUNT, ACCOUNT],
      noCode: 'corrupted',
      codeAt: NOW + HOUR,
      pause: { kind: 'other', until: NOW + HOUR },
      block: { kind: 'two_factor', fingerprint: ACCOUNT },
    },
    NOW,
  );
  assert.deepEqual(memory, {
    salt: null,
    session: null,
    noCode: [],
    twoFactor: [ACCOUNT],
    codeAt: NOW,
    pause: null,
    block: null,
  });
  assert.deepEqual(normalizeMemory(null, NOW).twoFactor, []);
});

test('the fingerprint: salted, of the e-mail (any case) and the password', () => {
  const salt = newSalt();
  assert.match(salt, /^[0-9a-f]{32}$/);
  const a = fingerprint(salt, 'Me@Example.com ', 'pw');
  assert.equal(a, fingerprint(salt, 'me@example.com', 'pw'));
  assert.notEqual(a, fingerprint(salt, 'me@example.com', 'pw2'));
  assert.notEqual(a, fingerprint(newSalt(), 'me@example.com', 'pw'));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('the file store: written whole, read back, missing file = nothing', async (t) => {
  const dir = mkdtempSync(join(import.meta.dirname, '.test-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = fileStore(join(dir, 'state.json'));
  assert.equal(await store.load(), null);
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(await store.load(), { a: 2 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), { a: 2 });
});
