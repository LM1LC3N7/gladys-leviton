// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake My Leviton behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LevitonApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  CODE,
  EMAIL,
  HOUR,
  IDS,
  MINUTE,
  NOW,
  PASSWORD,
  RESIDENCES,
  SECOND,
  USER_ID,
} from './fixtures/leviton.js';
import { fakeLeviton, memoryStore, settle } from './helpers/fakeLeviton.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const device = (id) => `ext:test-integration:device:${id}`;
const feature = (id, key) => `${device(id)}:${key}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeLeviton(),
    now = NOW,
    create = true,
    logs = [],
    mock = true,
  } = {},
) {
  if (mock) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  }
  const gladys = createFakeGladys({ config });
  const app = new LevitonApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const d of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(d);
    }
    await advance(2 * SECOND, SECOND);
  }
  const created = (id) => gladys.fake.devices.find((d) => d.external_id === device(id));
  /** Starts a command; `await` it to get the ack (move the clock first for a slow one). */
  const set = (id, key, value) => {
    const d = created(id);
    const f = d.features.find((x) => x.external_id === feature(id, key));
    return gladys.fake.setValue(d, f, value);
  };
  return { gladys, app, server, store, advance, created, set, logs };
}

const last = (gladys, id, key) => gladys.fake.lastState(feature(id, key));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const putBodies = (server) => server.puts().map((r) => [r.path, r.json]);
const until = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { email: EMAIL } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /e-mail and the password/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /mot de passe de votre compte My Leviton/);
});

test('the sign-in of decora-wifi, the residences, the devices, nothing secret kept', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path}`),
    [
      'POST /api/Person/login',
      `GET /api/Person/${USER_ID}/residentialPermissions`,
      'GET /api/ResidentialAccounts/77/residences',
      `GET /api/Residences/${RESIDENCES.home}/iotSwitches`,
      `GET /api/Residences/${RESIDENCES.cabin}/iotSwitches`,
    ],
  );
  const [login, permissions] = server.requests;
  assert.equal(login.host, 'my.leviton.com');
  assert.deepEqual(login.query, { include: 'user' });
  assert.deepEqual(login.json, { email: EMAIL, password: PASSWORD }, 'no code without a click');
  assert.equal(login.headers.authorization, undefined);
  assert.match(login.headers['User-Agent'], /gladys-leviton/);
  assert.ok(
    server.tokens.has(permissions.headers.authorization),
    'the token as decora-wifi sends it',
  );

  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id).sort();
  assert.deepEqual(
    ids,
    [IDS.dimmer, IDS.switch, IDS.outlet, IDS.unknownDimmer, IDS.cabin].map(device).sort(),
    'the fan and the button controller are not shown',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /5 device\(s\) Gladys can show \(out of 7\)/);

  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes(PASSWORD) && !saved.includes(EMAIL), 'neither password nor e-mail');
  assert.equal(store.data.session.account, accountKey(EMAIL));
  assert.equal(store.data.session.userId, String(USER_ID));
  const text = logs.join('\n');
  for (const secret of [PASSWORD, EMAIL, ...server.secrets]) {
    assert.ok(!text.includes(secret), 'no secret in the logs');
  }
});

test('the features: a dimmer is a light with a brightness, a switch or a plug an on/off', async (t) => {
  const { created } = await setup(t);
  const shape = (id) =>
    created(id).features.map((f) => [
      f.external_id.split(':').pop(),
      f.category,
      f.type,
      f.min,
      f.max,
      f.read_only,
    ]);
  assert.deepEqual(shape(IDS.dimmer), [
    ['power', 'light', 'binary', 0, 1, false],
    ['brightness', 'light', 'brightness', 0, 100, false],
    ['online', 'unknown', 'unknown', 0, 1, true],
  ]);
  assert.deepEqual(shape(IDS.switch), [
    ['power', 'switch', 'binary', 0, 1, false],
    ['online', 'unknown', 'unknown', 0, 1, true],
  ]);
  assert.deepEqual(shape(IDS.outlet), shape(IDS.switch));
  assert.deepEqual(shape(IDS.unknownDimmer), shape(IDS.dimmer), 'canSetLevel for an unknown model');
  const params = Object.fromEntries(created(IDS.dimmer).params.map((p) => [p.name, p.value]));
  assert.deepEqual(params, {
    model: 'DW6HD',
    firmware: '1.5.72',
    manufacturer: 'Leviton Manufacturing Co., Inc.',
    leviton_kind: 'dimmer',
  });
  assert.equal(created(IDS.dimmer).name, 'Kitchen');
  assert.ok(
    !JSON.stringify(created(IDS.dimmer)).includes('00:11:22'),
    'neither MAC nor local IP in Gladys',
  );
});

test('the states, the online state and the badges', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(last(gladys, IDS.dimmer, 'power'), 1);
  assert.equal(last(gladys, IDS.dimmer, 'brightness'), 75);
  assert.equal(last(gladys, IDS.dimmer, 'online'), 1);
  assert.equal(last(gladys, IDS.switch, 'power'), 0);
  assert.equal(last(gladys, IDS.cabin, 'power'), 0);
  assert.equal(last(gladys, IDS.outlet, 'online'), 0);
  assert.equal(last(gladys, IDS.outlet, 'power'), undefined, 'no stale state of an offline device');
  const badge = (id) =>
    gladys.fake.transports.filter((e) => e.device_external_id === device(id)).pop()?.transport;
  assert.equal(badge(IDS.dimmer), DEVICE_TRANSPORTS.CLOUD);
  assert.equal(badge(IDS.outlet), DEVICE_TRANSPORTS.UNREACHABLE);
});

test('one read per residence every 60 s, the token kept: no sign-in per cycle', async (t) => {
  const { server, advance } = await setup(t);
  const reads = server.reads().length;
  await advance(5 * MINUTE);
  assert.equal(server.reads().length, reads + 2 * 5, 'two residences, five cycles');
  assert.equal(server.logins().length, 1);
  assert.equal(server.of(`/api/Person/${USER_ID}/residentialPermissions`).length, 1);
  await advance(HOUR);
  assert.equal(
    server.of(`/api/Person/${USER_ID}/residentialPermissions`).length,
    2,
    'the residences again after an hour',
  );
});

test('the interval follows the configuration, bounded to 30-60 s', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, poll_interval: 5 } });
  const reads = server.reads().length;
  await advance(60 * SECOND);
  assert.equal(server.reads().length, reads + 4, '30 s at least: two cycles of two reads');
  await gladys.fake.configUpdated({ ...CONFIG, poll_interval: 60 });
  await settle();
  const after = server.reads().length;
  await advance(60 * SECOND);
  assert.equal(server.reads().length, after + 2);
});

test('a restart reuses the stored token: no new sign-in', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton();
  const first = await setup(t, { store, server });
  first.app.stop();
  const second = await setup(t, { store, server, mock: false, create: false });
  assert.equal(server.logins().length, 1);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
});

test('a token near its end is renewed by one sign-in, for an account without code', async (t) => {
  const server = fakeLeviton({ ttl: 3600 });
  const { advance } = await setup(t, { server });
  assert.equal(server.logins().length, 1);
  // One hour of life: renewed 6 minutes before (a tenth).
  await advance(50 * MINUTE, 30 * SECOND);
  assert.equal(server.logins().length, 1);
  await advance(6 * MINUTE, 30 * SECOND);
  assert.equal(server.logins().length, 2);
});

test('a refused token: one new sign-in and the read again; refused again right after, a spaced stop', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton();
  const { gladys, advance } = await setup(t, { server, store });
  server.revokeTokens();
  await advance(60 * SECOND);
  assert.equal(server.logins().length, 2, 'one new sign-in');
  assert.equal(gladys.fake.connectionStatus.connected, true);

  // Every new token refused at once.
  const issue = server.issue.bind(server);
  server.issue = () => {
    const token = issue();
    server.tokens.delete(token);
    return token;
  };
  server.revokeTokens();
  await advance(60 * SECOND);
  assert.equal(server.logins().length, 3, 'one sign-in per cycle at most');
  assert.match(message(gladys).en, /refused the session again/);
  assert.equal(store.data.block.kind, 'session_refused');
  await advance(50 * MINUTE, MINUTE);
  assert.equal(server.logins().length, 3, 'nothing before the hour');
  await advance(15 * MINUTE, MINUTE);
  assert.equal(server.logins().length, 4, 'one new try after an hour');
});

test('a refused password stops, survives a restart, and a new password lifts it', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton();
  server.password = 'another one';
  const first = await setup(t, { server, store, create: false });
  assert.equal(server.logins().length, 1);
  assert.match(message(first.gladys).en, /refused the e-mail or the password.*6 h/);
  assert.equal(store.data.block.kind, 'refused');
  await first.advance(2 * HOUR, MINUTE);
  assert.equal(server.logins().length, 1, 'never signed in again in a loop');
  first.app.stop();

  const second = await setup(t, { server, store, create: false, mock: false });
  assert.equal(server.logins().length, 1, 'the stop survives a restart');
  assert.match(message(second.gladys).fr, /refusé l'e-mail ou le mot de passe/);

  server.password = 'a new password';
  await second.gladys.fake.configUpdated({ email: EMAIL, password: 'a new password' });
  await settle();
  assert.equal(server.logins().length, 2);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.block, null);
});

test('a refused password is tried again after 6 h, then every 24 h', async (t) => {
  const server = fakeLeviton();
  server.password = 'another one';
  const { advance } = await setup(t, { server, create: false });
  await advance(6 * HOUR + MINUTE, 10 * MINUTE);
  assert.equal(server.logins().length, 2);
  await advance(12 * HOUR, 10 * MINUTE);
  assert.equal(server.logins().length, 2);
  await advance(12 * HOUR + MINUTE, 10 * MINUTE);
  assert.equal(server.logins().length, 3);
});

test('"too many failed attempts" pauses every path for an hour, kept in /data', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton();
  server.locked = true;
  const { gladys, advance } = await setup(t, { server, store, create: false });
  assert.match(message(gladys).en, /too many failed sign-ins: pausing for 60 min/);
  assert.equal(store.data.pause.kind, 'locked');
  await advance(55 * MINUTE, MINUTE);
  assert.equal(server.logins().length, 1);
  server.locked = false;
  await advance(10 * MINUTE, MINUTE);
  assert.equal(server.logins().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('verification code: one automatic e-mail at most, then the two buttons', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton({ otp: true });
  const logs = [];
  const { gladys, advance } = await setup(t, { server, store, create: false, logs });
  assert.equal(server.emails, 1, 'the first sign-in made Leviton e-mail a code');
  assert.match(message(gladys).en, /asks for a verification code/);
  assert.deepEqual(store.data.twoFactor, [accountKey(EMAIL)]);
  await advance(2 * HOUR, MINUTE);
  assert.equal(server.logins().length, 1, 'never signed in again without a click');

  let ack = await gladys.fake.action(ACTIONS.VERIFY_CODE, { code: '12' });
  assert.match(ack.data.message.en, /4 to 12 letters or digits/);
  ack = await gladys.fake.action(ACTIONS.VERIFY_CODE, { code: '000000' });
  assert.match(ack.data.message.en, /refused the code/);
  assert.deepEqual(server.logins().pop().json, {
    email: EMAIL,
    password: PASSWORD,
    code: '000000',
  });
  ack = await gladys.fake.action(ACTIONS.VERIFY_CODE, {
    code: ` ${CODE.slice(0, 3)}-${CODE.slice(3)} `,
  });
  assert.match(ack.data.message.en, /Code accepted/);
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(server.emails, 1);
  assert.ok(!logs.join('\n').includes(CODE), 'the code is never logged');
  assert.ok(!JSON.stringify(store.data).includes(CODE), 'nor kept');

  // The session works across cycles; refused, the account waits for the buttons.
  await advance(5 * MINUTE);
  assert.equal(server.logins().length, 3);
  server.revokeTokens();
  await advance(60 * SECOND);
  assert.match(message(gladys).en, /asks for a verification code/);
  await advance(HOUR, MINUTE);
  assert.equal(server.logins().length, 3, 'no sign-in by itself: it would e-mail a code');
  assert.equal(server.emails, 1);

  ack = await gladys.fake.action(ACTIONS.REQUEST_CODE);
  assert.match(ack.data.message.en, /e-mailing you a code/);
  assert.equal(server.emails, 2);
  ack = await gladys.fake.action(ACTIONS.REQUEST_CODE);
  assert.match(ack.data.message.en, /less than a minute ago/);
  assert.equal(server.emails, 2);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /asks for a verification code/);
  assert.equal(server.logins().length, 4);
});

test('a code account restarted without session waits for the buttons', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton({ otp: true });
  const first = await setup(t, { server, store, create: false });
  first.app.stop();
  store.data.session = null;
  const second = await setup(t, { server, store, create: false, mock: false });
  assert.equal(server.logins().length, 1);
  assert.match(message(second.gladys).en, /asks for a verification code/);
});

test('the code buttons while connected send nothing', async (t) => {
  const { gladys, server } = await setup(t);
  const before = server.requests.length;
  let ack = await gladys.fake.action(ACTIONS.REQUEST_CODE);
  assert.match(ack.data.message.en, /Already connected/);
  ack = await gladys.fake.action(ACTIONS.VERIFY_CODE, { code: CODE });
  assert.match(ack.data.message.en, /Already connected/);
  assert.equal(server.requests.length, before);
});

test('"Send the verification code" on an account without code just connects', async (t) => {
  const server = fakeLeviton();
  server.password = 'wrong';
  const { gladys } = await setup(t, { server, create: false });
  let ack = await gladys.fake.action(ACTIONS.REQUEST_CODE);
  assert.match(ack.data.message.en, /refused the e-mail or the password/);
  // The password fixed on the Leviton side: a click (after a minute) connects.
  server.password = PASSWORD;
  t.mock.timers.tick(MINUTE);
  ack = await gladys.fake.action(ACTIONS.REQUEST_CODE);
  assert.match(ack.data.message.en, /without a code: connected/);
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('commands: on/off, brightness within the device levels, 0 turns off, state read again', async (t) => {
  const { gladys, server, set, advance } = await setup(t);
  let ack = await set(IDS.switch, 'power', 1);
  assert.equal(ack.success, true);
  await settle();
  assert.equal(last(gladys, IDS.switch, 'power'), 1, 'shown at once');
  ack = await set(IDS.dimmer, 'brightness', 40);
  assert.equal(ack.success, true);
  for (const [key, value] of [
    ['brightness', 5],
    ['brightness', 0],
    ['power', 1],
  ]) {
    ack = await set(IDS.dimmer, key, value);
    assert.equal(ack.success, true);
  }
  assert.deepEqual(putBodies(server), [
    ['/api/IotSwitches/502', { power: 'ON' }],
    ['/api/IotSwitches/501', { power: 'ON', brightness: 40 }],
    ['/api/IotSwitches/501', { power: 'ON', brightness: 10 }],
    ['/api/IotSwitches/501', { power: 'OFF' }],
    ['/api/IotSwitches/501', { power: 'ON' }],
  ]);
  assert.equal(server.of('/api/IotSwitches/501', 'GET').length, 0);
  await advance(3 * SECOND, SECOND);
  assert.equal(server.of('/api/IotSwitches/501', 'GET').length, 1, 'read again once after');
  assert.equal(server.of('/api/IotSwitches/502', 'GET').length, 1);
  assert.equal(last(gladys, IDS.dimmer, 'power'), 1);
  assert.equal(last(gladys, IDS.dimmer, 'brightness'), 10);
});

test('commands refused: offline device, read-only feature, bad value, unknown feature', async (t) => {
  const { gladys, server, set, created } = await setup(t);
  let ack = await set(IDS.outlet, 'power', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /hors ligne/);
  ack = await set(IDS.switch, 'power', 2);
  assert.match(ack.error, /Valeur invalide/);
  ack = await set(IDS.dimmer, 'brightness', 'abc');
  assert.match(ack.error, /Valeur invalide/);
  ack = await set(IDS.switch, 'online', 1);
  assert.equal(ack.success, false);
  const d = created(IDS.switch);
  ack = await gladys.fake.setValue(
    d,
    { ...d.features[0], external_id: 'ext:test-integration:x' },
    1,
  );
  assert.equal(ack.success, false);
  assert.equal(server.puts().length, 0);
});

test('commands of one device wait for each other; a slow one is answered at 4.3 s', async (t) => {
  const { gladys, server, set, advance } = await setup(t);
  let release;
  server.before = async (request) => {
    if (request.method === 'PUT' && !release) {
      await new Promise((resolve) => {
        release = resolve;
      });
    }
  };
  const first = set(IDS.switch, 'power', 1);
  await settle();
  const second = set(IDS.switch, 'power', 0);
  const other = set(IDS.dimmer, 'power', 0);
  await settle();
  assert.equal(server.puts().length, 2, 'another device does not wait');
  await advance(4500, 100);
  const ack = await first;
  assert.equal(ack.success, true, 'Gladys answered, the request goes on');
  assert.equal(server.puts().length, 2, 'the second command of the device still waits');
  release();
  await settle();
  const late = await second;
  assert.equal(late.success, false, 'past its time: refused, never sent late');
  assert.match(late.error, /pas été envoyée/);
  assert.equal((await other).success, true);
  assert.equal(server.puts().length, 2);
  await advance(3 * SECOND, SECOND);
  assert.equal(last(gladys, IDS.switch, 'power'), 1);
});

test('a command answered after its read: the commanded value is held against a stale read', async (t) => {
  const { gladys, server, set, advance } = await setup(t);
  // Leviton applies the command a little later than it answers.
  server.queue.push({
    match: (r) => r.method === 'PUT',
    status: 200,
    body: { id: 502, power: 'ON' },
  });
  await set(IDS.switch, 'power', 1);
  await settle();
  assert.equal(last(gladys, IDS.switch, 'power'), 1);
  await advance(3 * SECOND, SECOND);
  assert.equal(last(gladys, IDS.switch, 'power'), 1, 'the stale read (OFF) is held back');
  assert.equal(server.device(IDS.switch).power, 'OFF');
  server.device(IDS.switch).power = 'ON';
  await advance(60 * SECOND);
  assert.equal(last(gladys, IDS.switch, 'power'), 1);
});

test('a refused or failed command says so', async (t) => {
  const { server, set } = await setup(t);
  server.queue.push({ match: (r) => r.method === 'PUT', status: 422, body: { error: {} } });
  let ack = await set(IDS.switch, 'power', 1);
  assert.match(ack.error, /refusé la commande.*HTTP 422/);
  server.queue.push({ match: (r) => r.method === 'PUT', status: 403, body: { error: {} } });
  ack = await set(IDS.switch, 'power', 1);
  assert.match(ack.error, /refusé la commande.*HTTP 403/, 'a 403 of a command: that command only');
  ack = await set(IDS.switch, 'power', 1);
  assert.equal(ack.success, true, 'no pause after a refused command');
  server.queue.push({ match: (r) => r.method === 'PUT', status: 503 });
  ack = await set(IDS.switch, 'power', 0);
  assert.match(ack.error, /résultat est inconnu/);
});

test('a refused token on a command: no sign-in from the command, the next cycle does it', async (t) => {
  const { server, set, advance } = await setup(t);
  server.revokeTokens();
  let ack = await set(IDS.switch, 'power', 1);
  assert.match(ack.error, /pas connecté/);
  assert.equal(server.logins().length, 1);
  ack = await set(IDS.switch, 'power', 1);
  assert.match(ack.error, /pas connecté/);
  assert.equal(server.puts().length, 1, 'no session: nothing sent');
  await advance(60 * SECOND);
  assert.equal(server.logins().length, 2);
  ack = await set(IDS.switch, 'power', 1);
  assert.equal(ack.success, true);
});

test('429: a bounded pause of every path, kept in /data, read back capped', async (t) => {
  const store = memoryStore();
  const server = fakeLeviton();
  const { gladys, set, advance } = await setup(t, { server, store });
  server.queue.push({
    match: (r) => r.method === 'GET',
    status: 429,
    body: '',
    headers: { 'retry-after': '3600' },
  });
  await advance(60 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'still connected, slowed down');
  assert.match(message(gladys).en, /HTTP 429\): pausing for 60 min/);
  assert.equal(store.data.pause.kind, 'rate');
  const reads = server.reads().length;
  let ack = await set(IDS.switch, 'power', 1);
  assert.match(ack.error, /ralentir/);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /HTTP 429/);
  await advance(55 * MINUTE, MINUTE);
  assert.equal(server.reads().length, reads, 'nothing during the pause');
  await advance(6 * MINUTE, MINUTE);
  assert.ok(server.reads().length > reads);
  assert.equal(server.puts().length, 0);
});

test('a pause read back from /data is capped (6 h) and kept across a change of account', async (t) => {
  const store = memoryStore({
    pause: { kind: 'rate', until: NOW + 48 * HOUR },
  });
  const server = fakeLeviton();
  const { gladys, advance } = await setup(t, { server, store, create: false });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).en, /pausing for 6 h/);
  await gladys.fake.configUpdated({ email: 'other@example.com', password: PASSWORD });
  await settle();
  assert.equal(server.requests.length, 0);
  await advance(6 * HOUR + MINUTE, 10 * MINUTE);
  assert.ok(server.logins().length >= 1);
});

test('5xx and network errors: retried after 1, 2, 5... minutes, never sooner than the interval', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.down = true;
  await advance(60 * SECOND);
  assert.match(message(gladys).en, /cannot be reached \(connection refused\)/);
  const count = server.requests.length;
  await advance(55 * SECOND);
  assert.equal(server.requests.length, count);
  await advance(10 * SECOND);
  assert.equal(server.requests.length, count + 1);
  server.down = false;
  await advance(2 * MINUTE + 5 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const badge = gladys.fake.transports.filter((e) => e.device_external_id === device(IDS.dimmer));
  assert.deepEqual(badge.map((e) => e.transport).slice(-2), [
    DEVICE_TRANSPORTS.UNREACHABLE,
    DEVICE_TRANSPORTS.CLOUD,
  ]);
});

test('a reconnection to Gladys sends the status, the Discovery list and the badges again', async (t) => {
  const { gladys, server, app } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const lists = gladys.fake.bodies('POST', '/discovered_device').length;
  const logins = server.logins().length;
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, lists + 1);
  assert.equal(server.logins().length, logins, 'the session stays');
  assert.equal(app.started, true);
});

test('the Discovery list never shrinks, and created features are kept as Gladys has them', async (t) => {
  const { gladys, server, advance, created } = await setup(t);
  server.residences[RESIDENCES.cabin] = [];
  await advance(60 * SECOND);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes(device(IDS.cabin)), 'a device gone from Leviton stays published');
  const published = gladys.fake.discoveredDevices.find((d) => d.external_id === device(IDS.dimmer));
  assert.deepEqual(
    published.features.map((f) => f.external_id),
    created(IDS.dimmer).features.map((f) => f.external_id),
  );
  await gladys.fake.scanRequest();
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.external_id === device(IDS.cabin)));
});

test('feature names follow the language of the configuration', async (t) => {
  const { gladys } = await setup(t, { config: { ...CONFIG, language: 'en' }, create: false });
  const dimmer = gladys.fake.discoveredDevices.find((d) => d.external_id === device(IDS.dimmer));
  assert.deepEqual(
    dimmer.features.map((f) => f.name),
    ['On/Off', 'Brightness', 'Online (1 = yes)'],
  );
});

test('the test button: one read, at most every 30 s', async (t) => {
  const { gladys, server } = await setup(t);
  const reads = server.reads().length;
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to My Leviton/);
  assert.equal(server.reads().length, reads + 2);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /less than 30 seconds/);
  assert.equal(server.reads().length, reads + 2);
});

test('the real timers work too (no mocked clock)', async (t) => {
  const { gladys } = await setup(t, { mock: false, create: false });
  await until(5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
