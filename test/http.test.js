// -----------------------------------------------------------------------------
// The transport against a loopback server (no network), and the reading of
// the LoopBack error envelope.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  LevitonError,
  apiError,
  envelopeOf,
  errorReason,
  httpRequest,
  loginError,
  parseRetryAfter,
} from '../src/http.js';

const loopback = (err) => ({
  body: JSON.stringify({ error: { statusCode: 0, name: 'Error', ...err } }),
  headers: {},
});

test('sign-in answers: refused, code asked, code refused, locked, rejected, transient', () => {
  const kind = (status, err, options) => loginError({ status, ...loopback(err) }, options)?.kind;
  assert.equal(loginError({ status: 200, body: '{}', headers: {} }), undefined);
  assert.equal(kind(401, { message: 'Login Failed' }), 'refused');
  assert.equal(
    kind(406, {
      message: 'Insufficient Data: Person uses two factor authentication. Requires code.',
    }),
    'two_factor',
  );
  assert.equal(kind(406, {}, { withCode: true }), 'code_refused');
  assert.equal(kind(408, { message: 'Error: Invalid code' }, { withCode: true }), 'code_refused');
  assert.equal(kind(408, {}), 'login_rejected', 'a 408 without code: a spaced stop');
  assert.equal(kind(403, { message: 'Too many failed attempts' }), 'locked');
  assert.equal(kind(400, { message: 'whatever' }), 'login_rejected');
  assert.equal(kind(429, {}), 'rate_limited');
  assert.equal(kind(502, {}), 'unavailable');
});

test('API answers: 401 token, 403, 429 with Retry-After, 5xx, others', () => {
  assert.equal(apiError({ status: 204, body: '' }), undefined);
  assert.equal(apiError({ status: 401, body: '' }).kind, 'unauthorized');
  assert.equal(apiError({ status: 403, body: '' }).kind, 'forbidden');
  const limited = apiError({ status: 429, headers: { 'retry-after': '120' }, body: '' });
  assert.equal(limited.kind, 'rate_limited');
  assert.equal(limited.retryAfter, 120_000);
  assert.equal(apiError({ status: 500, body: '<html>' }).kind, 'unavailable');
  assert.equal(apiError({ status: 404, body: '' }).kind, 'http');
});

test('the envelope: only a short upper-case code is ever kept for the logs', () => {
  const err = apiError({
    status: 401,
    ...loopback({
      message: 'secret free text someone@example.com',
      code: 'AUTHORIZATION_REQUIRED',
    }),
  });
  assert.equal(err.code, 'AUTHORIZATION_REQUIRED');
  assert.ok(!errorReason(err).includes('example.com'));
  assert.deepEqual(envelopeOf('not json'), {});
  assert.equal(
    envelopeOf(JSON.stringify({ error: { code: 'bad code with spaces' } })).code,
    undefined,
  );
  assert.equal(errorReason(new Error('the password is x')), 'unexpected error');
});

test('Retry-After: seconds or a date', () => {
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(parseRetryAfter(''), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

async function server(handler) {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() };
}

test('the transport: bounded answers, timeouts, never a redirect followed', async (t) => {
  const s = await server((req, res) => {
    if (req.url === '/big') {
      res.end('x'.repeat(5000));
    } else if (req.url === '/slow') {
      setTimeout(() => res.end('{}'), 500);
    } else if (req.url === '/redirect') {
      res.writeHead(307, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    } else {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => res.end(JSON.stringify({ method: req.method, body })));
    }
  });
  t.after(() => s.close());
  const ok = await httpRequest(`${s.url}/echo`, { method: 'POST', body: '{"a":1}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { method: 'POST', body: '{"a":1}' });
  await assert.rejects(httpRequest(`${s.url}/big`, { maxBytes: 1000 }), { kind: 'size' });
  await assert.rejects(httpRequest(`${s.url}/slow`, { timeout: 50 }), (err) => {
    assert.ok(err instanceof LevitonError);
    assert.equal(err.kind, 'timeout');
    assert.equal(err.notSent, false, 'the request had left');
    return true;
  });
  let sent = false;
  const slow = await httpRequest(`${s.url}/slow`, {
    timeout: 2000,
    sendWithin: 50,
    onSent: () => {
      sent = true;
    },
  });
  assert.equal(slow.status, 200, 'the send limit stops only a request that has not left');
  assert.ok(sent);
  const redirect = await httpRequest(`${s.url}/redirect`, { method: 'POST', body: '{}' });
  assert.equal(redirect.status, 307, 'answered as is, never followed');
  await assert.rejects(httpRequest('http://127.0.0.1:1/'), { kind: 'network' });
});
