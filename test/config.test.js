import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountKey, normalizeConfig } from '../src/config.js';

test('the configuration normalized: trimmed e-mail, bounded interval, known language', () => {
  const config = normalizeConfig({
    email: ' Me@Example.com ',
    password: ' spaces kept ',
    poll_interval: '45',
    language: 'EN',
  });
  assert.equal(config.email, 'Me@Example.com');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.account, accountKey('me@example.com'));
  assert.equal(config.pollInterval, 45);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 30);
  assert.equal(normalizeConfig({ poll_interval: 600 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: null }).pollInterval, 60);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig().account, '');
});
