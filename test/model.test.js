// -----------------------------------------------------------------------------
// The pure parts: iotSwitches -> devices, kinds, answers merged, session.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idOf, sessionOf } from '../src/client.js';
import { HOUR, MINUTE } from '../src/constants.js';
import { kindOf, readDevices, readSwitch, withAnswer } from '../src/model.js';
import { cabinDevices, homeDevices } from './fixtures/leviton.js';

test('kinds: the model first, canSetLevel for an unknown one; fans, remotes, bridges hidden', () => {
  assert.equal(kindOf({ model: 'DW6HD', power: 'OFF', canSetLevel: false }), 'dimmer');
  assert.equal(kindOf({ model: 'dw15p', power: 'ON' }), 'outlet');
  assert.equal(kindOf({ model: 'D215S', power: 'ON', canSetLevel: true }), 'switch');
  assert.equal(kindOf({ model: 'NEW1', power: 'ON', canSetLevel: true }), 'dimmer');
  assert.equal(kindOf({ model: 'NEW1', power: 'ON' }), 'switch');
  assert.equal(kindOf({ model: 'DW4SF', power: 'ON' }), undefined);
  assert.equal(kindOf({ model: 'DW4BC' }), undefined);
  assert.equal(kindOf({ model: 'MLWSB', power: 'ON' }), undefined);
  assert.equal(kindOf({ model: 'DW15S' }), undefined, 'no power state: not shown');
});

test('a device read: ids, names, levels, online; nothing guessed', () => {
  const kitchen = readSwitch(homeDevices()[0]);
  assert.deepEqual(kitchen, {
    id: '501',
    name: 'Kitchen',
    model: 'DW6HD',
    version: '1.5.72',
    manufacturer: 'Leviton Manufacturing Co., Inc.',
    kind: 'dimmer',
    power: 1,
    brightness: 75,
    minLevel: 10,
    maxLevel: 100,
    online: true,
  });
  const odd = readSwitch({
    id: 9,
    name: '  Bad\u0000name  ',
    power: 'MAYBE',
    brightness: 140,
    minLevel: 0,
    connected: 'yes',
  });
  assert.equal(odd.name, 'Bad name');
  assert.equal(odd.power, undefined);
  assert.equal(odd.brightness, undefined);
  assert.equal(odd.minLevel, 1);
  assert.equal(odd.maxLevel, 100);
  assert.equal(odd.online, undefined);
  assert.equal(readSwitch({ name: 'no id' }), undefined);
  assert.equal(readSwitch({ id: '../x' }), undefined);
  assert.equal(readSwitch({ id: 12, power: 'ON' }).name, 'Leviton 12');
});

test('devices of several residences, a duplicate kept once', () => {
  const devices = readDevices([homeDevices(), cabinDevices(), [homeDevices()[0]], 'junk']);
  assert.equal(devices.size, 7);
});

test('an answer changes only what it carries', () => {
  const before = readSwitch(homeDevices()[0]);
  assert.deepEqual(withAnswer(before, { power: 'OFF' }), { ...before, power: 0 });
  assert.deepEqual(withAnswer(before, { power: 'ON', brightness: 20 }), {
    ...before,
    brightness: 20,
  });
  assert.deepEqual(withAnswer(before, { id: 999, power: 'OFF' }), before, 'another device');
  assert.equal(withAnswer(before, { model: 'DW15S', power: 'ON' }).kind, 'dimmer', 'kind kept');
  assert.equal(withAnswer(before, { connected: false }).online, false);
});

test('ids of the API: numbers or plain strings only', () => {
  assert.equal(idOf(42), '42');
  assert.equal(idOf('abc-1'), 'abc-1');
  assert.equal(idOf(1.5), undefined);
  assert.equal(idOf('a/b'), undefined);
  assert.equal(idOf(''), undefined);
  assert.equal(idOf(undefined), undefined);
});

test('the session of a sign-in: its life, its renewal margin, its user id', () => {
  const now = 1_000_000;
  const twoWeeks = sessionOf({ id: 'tok', ttl: 1_209_600, userId: 7 }, now);
  assert.equal(twoWeeks.expiresAt, now + 1_209_600_000);
  assert.equal(twoWeeks.renewAt, twoWeeks.expiresAt - HOUR, 'at most one hour before');
  const hour = sessionOf({ id: 'tok', ttl: 3600, user: { id: 'u1' } }, now);
  assert.equal(hour.userId, 'u1');
  assert.equal(hour.renewAt, now + HOUR - 6 * MINUTE);
  const eternal = sessionOf({ id: 'tok', ttl: -1, userId: 7 }, now);
  assert.equal(eternal.expiresAt, now + HOUR, 'no usable ttl: one hour, as homebridge-myleviton');
  assert.throws(() => sessionOf({ ttl: 3600, userId: 7 }, now), { kind: 'bad_response' });
  assert.throws(() => sessionOf({ id: 'tok' }, now), { kind: 'bad_response' });
  assert.throws(() => sessionOf(undefined, now), { kind: 'bad_response' });
});
