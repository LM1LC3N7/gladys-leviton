# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to My
Leviton (the Leviton Decora Smart Wi-Fi cloud) with the e-mail and password of
the app (plus the code Leviton e-mails when the account uses one), reads the
devices of each residence once per cycle, and shows and commands dimmers,
switches and plugs. Ported from decora-wifi and schmittx's Home Assistant
integration (MIT). Unofficial API, never tested with a real account, not
affiliated with Leviton.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          LevitonApp: cycle and its timer, failures, stops and pauses,
                    devices, states, commands (queue, deadlines, holds), badges, buttons
src/client.js       the account: sign-in, code, token, the My Leviton calls
src/http.js         the only network access (node:https, bounded), errors, envelope
src/model.js        iotSwitches -> devices, kinds (pure)
src/devices.js      device -> Gladys features, reads, command bodies (pure)
src/publisher.js    states within 300/min
src/store.js        /data/leviton-state.json: token, code accounts, pause, stops
src/config.js       config_schema normalized, account key (hash of the e-mail)
src/constants.js    host, paths, models, manifest keys, limits, timings
src/i18n.js         runtime texts and feature names (en/fr), command errors
test/fixtures/      iotSwitches shaped like decora-wifi's models
test/helpers/       a fake My Leviton behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device `device:<Leviton id>`, features
  `power`, `brightness`, `online`. Never change how they are built; the kind
  of a device comes from its model first so that it never changes.
- Manifest keys (`email`, `password`, `poll_interval`, `language`, the actions
  `test_connection`, `request_code`, `verify_code` (`code`)) are frozen.
- **Commands**: one at a time per device, refused before they are sent when
  they cannot be answered within Gladys' 5 s, sent once (never retried), never
  a sign-in from a command, refused for an offline device.
- **Never a code sent without a click**, never a code kept; an account that
  asked for a code is never signed in again by itself. Never sign in again in
  a loop: at most one sign-in per cycle, spaced new tries after a refusal.
  Never log or put in a message the password, the token, the user id or a
  code.
- Polling politely: one request per residence per cycle, 30 to 60 s, never
  sooner than the interval after an error; 429 pauses every path. Never add a
  call outside `LevitonClient`.
- The Discovery list never shrinks; status and Discovery are sent again at
  every `connected`; a reconnection keeps the session, the stops and the
  pauses.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`; a `secret`
  field is kept by Gladys in its database, never write that it is encrypted.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network nor the system temp directory.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow (0.1.0 was set by
  hand once, see TODO.md).
