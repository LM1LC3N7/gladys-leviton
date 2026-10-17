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
  before, 5 min to 1 h) or refused, at most once per cycle.
- **Verification code** (as schmittx's integration): the sign-in answers 406
  "Requires code" (Leviton e-mails a code); _Verify the code_ sends the same
  sign-in with `code`, _Send the verification code_ a sign-in without code
  (a new e-mail, at most once a minute). An account that asked for a code is
  remembered (a hash of its e-mail) and never signed in again without a
  click: its token is used until Leviton refuses it. The code is never kept.
- **Reads**: `/Person/<id>/residentialPermissions`, then
  `/ResidentialAccounts/<id>/residences` (or the residence of the
  permission), every hour; `/Residences/<id>/iotSwitches` every 60 s (30–60),
  one request per residence. Answers read up to 2 MiB; redirects never
  followed.
- **Commands**: `PUT /IotSwitches/<id>` with `{ "power": "ON" | "OFF" }` or
  `{ "power": "ON", "brightness": n }` (bounded to `minLevel`–`maxLevel`; 0
  turns off), one at a time per device, sent within 3 s of the click or
  refused unsent, Gladys answered at 4.3 s at the latest, never a sign-in
  from a command; the answer shown at once and held 15 s against a stale
  read, `GET /IotSwitches/<id>` 2 s after.
- **Errors**: a refused token: one new sign-in and the read again; refused
  again right after, a stop with new tries after 1 h, 6 h, then every 24 h. A
  refused password or a rejected sign-in: a stop, new tries after 6 h then
  every 24 h (none for a code account). 429 (`Retry-After` bounded to
  1 min – 6 h, 15 min without it), "too many failed attempts" and a 403 of the
  reads (1 h) pause every path. Stops and pauses are kept in `/data` and
  capped when read back. 5xx/network: 1, 2, 5, 10, then 15 minutes, never
  under the interval.
- **Gladys side**: one device per supported iotSwitch (`device:<Leviton id>`);
  dimmers `light/binary` + `light/brightness`, switches and plugs
  `switch/binary`, `online` as `unknown/unknown` read only, a transport badge
  per device. The Discovery list never shrinks: created features are kept as
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
