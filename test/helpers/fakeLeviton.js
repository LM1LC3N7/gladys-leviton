// -----------------------------------------------------------------------------
// A fake My Leviton behind the transport the integration is given: the
// sign-in (with the verification code when asked), the residential
// permissions, accounts and residences, the iotSwitches and their writes.
// Answers and errors are shaped like LoopBack's (schmittx's parse_response).
// Records every request. No network.
// -----------------------------------------------------------------------------

import { LevitonError } from '../../src/http.js';
import {
  ACCOUNT_ID,
  CODE,
  EMAIL,
  PASSWORD,
  RESIDENCES,
  USER_ID,
  cabinDevices,
  homeDevices,
} from '../fixtures/leviton.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
});

const loopbackError = (statusCode, message, code) =>
  answer(statusCode, { error: { statusCode, name: 'Error', message, ...(code ? { code } : {}) } });

export function fakeLeviton({ otp = false, ttl = 1_209_600 } = {}) {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    otp,
    code: CODE,
    ttl,
    residences: {
      [RESIDENCES.home]: homeDevices(),
      [RESIDENCES.cabin]: cabinDevices(),
    },
    /** { method, path, query, headers, json } */
    requests: [],
    tokens: new Set(),
    issued: 0,
    /** Every secret ever issued, to check none reaches the logs. */
    secrets: [],
    /** Codes e-mailed (a sign-in without code on an account that uses one). */
    emails: 0,
    down: false,
    locked: false,
    /** One-shot answers: { match(request), status, body, headers } */
    queue: [],
    /** Called with each request before it is answered (may wait). */
    before: undefined,
    of(path, method) {
      return this.requests.filter((r) => r.path === path && (!method || r.method === method));
    },
    logins() {
      return this.of('/api/Person/login', 'POST');
    },
    reads() {
      return this.requests.filter(
        (r) => r.method === 'GET' && /^\/api\/Residences\/[^/]+\/iotSwitches$/.test(r.path),
      );
    },
    puts() {
      return this.requests.filter((r) => r.method === 'PUT');
    },
    device(id) {
      return Object.values(this.residences)
        .flat()
        .find((d) => String(d.id) === String(id));
    },
    revokeTokens() {
      this.tokens.clear();
    },
    issue() {
      this.issued += 1;
      const token = `tok${this.issued}${Math.random().toString(36).slice(2)}`;
      this.secrets.push(token);
      this.tokens.add(token);
      return token;
    },
  };

  server.transport = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    const request = {
      method,
      host: target.host,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers,
      json: body ? JSON.parse(body) : undefined,
    };
    server.requests.push(request);
    await server.before?.(request);
    if (server.down) {
      throw new LevitonError('network', 'connection refused', { notSent: true });
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [{ status, body: forcedBody, headers: forcedHeaders }] = server.queue.splice(forced, 1);
      return answer(status, forcedBody, forcedHeaders);
    }
    if (target.host !== 'my.leviton.com') {
      return answer(404, 'not found');
    }
    const path = request.path;
    if (method === 'POST' && path === '/api/Person/login') {
      const { email, password, code } = request.json ?? {};
      if (server.locked) {
        return loopbackError(403, 'Too many failed attempts');
      }
      if (email !== server.email || password !== server.password) {
        return loopbackError(401, 'Login Failed', 'LOGIN_FAILED');
      }
      if (server.otp && code === undefined) {
        server.emails += 1;
        return loopbackError(
          406,
          'Insufficient Data: Person uses two factor authentication. Requires code.',
        );
      }
      if (server.otp && code !== server.code) {
        return loopbackError(408, 'Error: Invalid code');
      }
      const token = server.issue();
      return answer(200, {
        id: token,
        ttl: server.ttl,
        created: new Date().toISOString(),
        userId: USER_ID,
        user: { id: USER_ID, firstName: 'Some', lastName: 'One', email: server.email },
      });
    }
    if (!server.tokens.has(headers.authorization)) {
      return loopbackError(401, 'Authorization Required', 'AUTHORIZATION_REQUIRED');
    }
    if (method === 'GET' && path === `/api/Person/${USER_ID}/residentialPermissions`) {
      return answer(200, [
        { id: 1, personId: USER_ID, residentialAccountId: ACCOUNT_ID, access: 'owner' },
        { id: 2, personId: USER_ID, residenceId: RESIDENCES.cabin, access: 'guest' },
      ]);
    }
    if (method === 'GET' && path === `/api/ResidentialAccounts/${ACCOUNT_ID}/residences`) {
      return answer(200, [{ id: RESIDENCES.home, name: 'Home', residentialAccountId: ACCOUNT_ID }]);
    }
    let match = /^\/api\/Residences\/([^/]+)\/iotSwitches$/.exec(path);
    if (method === 'GET' && match) {
      const list = server.residences[match[1]];
      return list ? answer(200, list) : loopbackError(404, 'Unknown residence');
    }
    match = /^\/api\/IotSwitches\/([^/]+)$/.exec(path);
    const device = match ? server.device(match[1]) : undefined;
    if (match && !device) {
      return loopbackError(404, 'Unknown device');
    }
    if (method === 'GET' && device) {
      return answer(200, device);
    }
    if (method === 'PUT' && device) {
      for (const key of ['power', 'brightness']) {
        if (request.json && key in request.json) {
          device[key] = request.json[key];
        }
      }
      return answer(200, device);
    }
    return loopbackError(404, 'There is no method to handle ' + method + ' ' + path);
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
