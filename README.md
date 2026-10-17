# gladys-leviton

[Gladys Assistant](https://gladysassistant.com) external integration for
**Leviton Decora Smart Wi-Fi** switches, dimmers and plugs (US, CA) through
the **My Leviton** cloud: on/off, brightness, online state, and the
verification code of two-factor accounts in two buttons. **Unofficial API,
never tested with a real account. Not affiliated with Leviton.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (LevitonApp)
                                  ├─ src/client.js     sign-in, code, token, the My Leviton calls
                                  ├─ src/http.js       the only HTTPS access, errors, bounds
                                  ├─ src/model.js      iotSwitches -> devices, kinds (pure)
                                  ├─ src/devices.js    device -> Gladys features, commands (pure)
                                  ├─ src/publisher.js  states within 300/min
                                  └─ src/store.js      /data/leviton-state.json
```

- **Sign-in** (as decora-wifi): `POST https://my.leviton.com/api/Person/login?include=user`
  with the e-mail and the password; the `id` of the answer is the token, sent
  as the `authorization` header; its `ttl` gives its end (one hour assumed
  without it). The token is kept in `/data` and reused across cycles and
  restarts; a new sign-in only when it is about to end (a tenth of its life
  before, 5 min to 1 h, at most half of it) or refused, at most once per
  cycle.
- **Never a sign-in without a click, except for an account known "without
  code"**: a sign-in without code e-mails a code to a two-factor account.
  `/data` keeps the accounts (hashes of the e-mail) whose sign-in without code
  was answered 200, removed at the first 406; only those are signed in by
  themselves (start, reconnection, renewal, spaced new tries). Any other
  account, or a lost `/data`, stops with "Sign-in required", no timer. Saving
  the configuration and the buttons are clicks, each allowing one sign-in in
  the cycle it starts only (a click during a pause is spent then).
- **Verification code** (as schmittx's integration): the sign-in answers 406
  "Requires code" (Leviton e-mails a code); _Verify the code_ sends the same
  sign-in with `code`, _Send the verification code_ a sign-in without code
  (a new e-mail, at most once a minute). A code account's token is used
  until Leviton refuses it. The code is never kept.
- **Reads**: `/Person/<id>/residentialPermissions`, then the residence and/or
  the `/ResidentialAccounts/<id>/residences` of each permission (both read
  when a permission holds both), every hour; `/Residences/<id>/iotSwitches`
  every 60 s (30–60), one request per residence, each on its own: a residence
  in error keeps its last devices (unreachable, not sent again) and the
  others go on. Answers read up to 2 MiB; redirects never followed; a new
  socket per request.
- **Commands**: `PUT /IotSwitches/<id>` with `{ "power": "ON" | "OFF" }` or
  `{ "power": "ON", "brightness": n }` (bounded to `minLevel`–`maxLevel`; 0
  turns off), one at a time per device, sent within 3 s of the click (queue,
  sign-in in progress and a send limit included) or refused unsent, "done" at
  4.3 s only once sent, never a sign-in from a command; the answer shown at
  once and held 15 s against a stale read, `GET /IotSwitches/<id>` 2 s after.
- **Errors**: a refused token: one new sign-in and the read again; refused
  again right after, a stop with new tries after 1 h, 6 h, then every 24 h. A
  refused password or a rejected sign-in: a stop, new tries after 6 h then
  every 24 h (only for an account known without code; any other waits for a
  click). 429 (`Retry-After` bounded to 1 min – 6 h, 15 min without it) and
  "too many failed attempts" (1 h) pause every path; a 403 of the reads
  pauses every path (1 h) only when every residence fails (after a new
  sign-in, for an account known without code); a 403 of one residence pauses
  nothing. Stops and pauses are kept in `/data` and capped when read back.
  5xx/network: 1, 2, 5, 10, then 15 minutes, never under the interval.
- **Gladys side**: one device per supported iotSwitch (`device:<Leviton id>`);
  dimmers `light/binary` + `light/brightness`, switches and plugs
  `switch/binary`, `online` as `unknown/unknown` read only, a transport badge
  per device. GFCI outlets (D2GF1, D2GF2), fans, button controllers and the
  bridge are hidden; a model not in the lists is shown read only. The
  Discovery list never shrinks: created features are kept as
  Gladys has them, devices seen earlier stay. Status, Discovery, badges and
  states are sent again at every reconnection to Gladys.

## Credits

The endpoints, the sign-in and the device attributes are ported from
[decora-wifi](https://github.com/tlyakhov/python-decora_wifi) (Tim
Lyakhovetskiy, MIT), the library of the Home Assistant `decora_wifi`
integration; the verification code and the model list from
[home-assistant-leviton-decora-smart-wifi](https://github.com/schmittx/home-assistant-leviton-decora-smart-wifi)
(Matt Schmitt, MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The
Home Assistant `decora_wifi` integration (Apache-2.0) and
[homebridge-myleviton](https://github.com/tbaur/homebridge-myleviton) (tbaur,
Apache-2.0) were read, no code taken. Modelled on the sibling integrations
[gladys-ohme](https://github.com/LM1LC3N7/gladys-ohme) (cloud e-mail and
password) and [gladys-hubspace](https://github.com/LM1LC3N7/gladys-hubspace)
(lights and plugs, a code in two buttons).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: My Leviton is a fake behind the injected
transport (LoopBack answers and errors, iotSwitches shaped like decora-wifi's
models), Gladys is the SDK's fake; `test/http.test.js` runs the real transport
against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from MIT projects, credited
with their notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
