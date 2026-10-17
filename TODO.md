# TODO — Leviton Decora Smart Wi-Fi v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #241) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-17): sign-in ported from decora-wifi,
      the verification code in two buttons (schmittx's 406/408 flow), the
      token kept and reused, residences every hour and their devices every
      cycle (60 s, 30–60), dimmers (light on/off + brightness), switches and
      plugs (switch on/off), an online state per device, commands serialized
      per device within Gladys' 5 s and read again after, 401/403/429/5xx
      handling with persisted stops and pauses, badges, docs en/fr, cover.
      Tested against made-up answers only (Node 22 and 24, 89 tests). Store
      validator: green with `--skip-image-check`; without it, its only error
      is the `docker_image` not yet pullable from GHCR. No Docker on this PC:
      the image was not built here (the CI builds it). Cover drawn by
      `_ref/make-cover-leviton.mjs` (plain Node, outside the repository).
- [x] **Milestone 1 fixes — review** (2026-10-18): no sign-in without a click
      unless the account is known "without code"; commands never sent after
      3 s (send limit, sign-in in progress, queue); unknown results after a
      non-JSON 200; residences read one by one; GFCI hidden; unknown models
      read only; atomic `/data` writes with fsync; minor points (renewal
      margin, 408, fresh sockets, permissions with both ids, pause messages,
      account change). 102 tests on Node 22 and 24.
- [ ] **Milestone 2 — real account**: run against a real account (see "To
      check on a real account"), turn the answers (anonymized) into
      fixtures, fix what differs.
- [ ] **Milestone 3 — more devices**: fan speed controllers (DW4SF, D24SF:
      `fan/percent` from the brightness, schmittx's 4 speeds), the motion
      sensor of the D2MSD (`motionOccupied`), the GFCI outlets D2GF1/D2GF2
      (hidden now; their fault state read only, never a switch), button
      controllers as scene triggers.
- [ ] **Milestone 4 — live updates**: the websocket of the app
      (`wss://my.leviton.com/socket/websocket` for homebridge-myleviton,
      `socket.cloud.leviton.com` for another client), with REST polling as a
      true-up, if it proves stable.

## To check on a real account

- The sign-in answer: `id`, `ttl` (LoopBack default two weeks; one hour
  assumed without it), `userId`; whether `include=user` is still accepted;
  whether a body without `clientId` / `registeredVia` (decora-wifi sends
  `levdb-echo-proto` / `myLeviton`) is accepted.
- Two-factor: does the 406 itself make Leviton e-mail the code (assumed,
  from Leviton's support page and schmittx's flow), how long the code lives,
  its format (4 to 12 letters or digits accepted), the exact 406/408 bodies,
  and the lifetime of a session obtained with a code (does Leviton refuse it
  sooner than its `ttl`?).
- The permissions: `residentialAccountId` and/or `residenceId`;
  `primaryResidenceId` of the account (homebridge reads it, not needed when
  `/residences` lists it).
- The device list: `connected`, `canSetLevel`, `minLevel` / `maxLevel` on
  the 2nd-generation devices; any power or energy attribute (none in the
  references: none published).
- The PUT answer: the whole device (decora-wifi updates its data with the
  attributes sent; homebridge reads the answer as the status) or less; the
  delay before a read shows a command (the 15 s hold, the read 2 s after).
- 403 of the API: a token refusal (decora-wifi treats it like a 401) or an
  access refusal; rate limits (none documented; homebridge keeps 300
  writes/min on its side).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-leviton:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **Licenses**: decora-wifi is MIT (Tim Lyakhovetskiy, 2017) and
  home-assistant-leviton-decora-smart-wifi is MIT (Matt Schmitt, 2023), both
  checked before use; their logic is ported (full MIT notices in
  `THIRD_PARTY_NOTICES.md`, shipped in the image). The Home Assistant
  `decora_wifi` integration (Apache-2.0) and homebridge-myleviton
  (Apache-2.0) were only read. ha-levitonsmart (simplytoast1) has no license:
  not used. `LICENSE`: the standard Apache-2.0 text, no name (copied from
  gladys-tedee).
- **"My Leviton" cloud**: decora-wifi, the Home Assistant integrations and
  homebridge-myleviton all talk to `my.leviton.com/api` (the cloud of the My
  Leviton app); no other REST host is known. The websocket is left for later.
- **Own client on `node:https`**, no Python: runtime dependency the SDK only.
  Redirects never followed (a login replayed elsewhere would carry the
  password, homebridge-myleviton's point). Honest User-Agent
  `gladys-leviton/0.1 (+repository)`.
- **Sign-in body**: `{ email, password }` (+ `code` from the button only), as
  schmittx and homebridge-myleviton; decora-wifi's `clientId` /
  `registeredVia` are not sent (to check, see above).
- **Password**: in the Gladys `secret` field (kept by Gladys in its database,
  never shown again, sent only to my.leviton.com). `/data` never holds the
  e-mail, the password nor a code.
- **Session renewal**: Leviton has no refresh token: the session is the
  LoopBack token. It is kept in `/data` and reused at every cycle and after a
  restart; renewed by one sign-in a tenth of its life before its end (5 min
  to 1 h, never more than half of its life), only for an account known
  "without code". Any other account keeps its token until Leviton refuses it
  (a renewal could e-mail a code).
- **No sign-in without a click unless known "without code" (review B1)**: a
  sign-in without code makes Leviton e-mail a code to a two-factor account,
  and nothing tells beforehand. `/data` keeps the accounts (hashes of the
  e-mail) whose sign-in without code was answered 200 ("no code" list),
  removed at the first 406. Only those are signed in automatically (start,
  reconnection to Gladys, renewal, spaced new tries). Any other account, an
  empty or corrupted `/data` included, stops with "Sign-in required: click
  Test the connection", no timer (derived again at every start from `/data`:
  no session and not "no code"). A click is: the configuration saved
  (`onConfigUpdated`, which also lifts a stop waiting for a click), "Test the
  connection", and the two code buttons; it allows one sign-in, for the next
  cycle only. A reconnection to Gladys is not a click.
- **Two-factor (I7, documented en/fr)**: an account known "without code"
  that turns two-factor on later may get at most one e-mail at its next
  automatic sign-in (renewal, refused token); the 406 then removes it from
  the "no code" list and marks it as a code account: never signed in again
  without a click. "Send the verification code" = a sign-in without code (a
  new e-mail), at most once a minute (kept in `/data`), refused while
  connected. "Verify the code" sends the e-mail, the password and the code,
  refused while connected. A sign-in without code that succeeds (200) puts
  the account in the "no code" list. The code is never kept nor sent again
  (schmittx re-sends the stored one at each sign-in: not done).
- **Refusals** (Ohme's and Hubspace's model, approved): a refused token (401;
  a 403 too on the reads, as decora-wifi) is dropped and one new sign-in
  done, the read retried once; refused again, or refused right after a
  sign-in: `session_refused`, new tries after 1 h, 6 h, then every 24 h. 401
  "Login Failed" (`refused`) and any other 4xx of the sign-in
  (`login_rejected`, a 408 without code included): a stop, new tries after
  6 h then every 24 h, only for an account known "without code" (any other
  waits for a click). Stops kept in `/data` with a salted fingerprint of the
  e-mail and password (a new password lifts them), their next try and
  count, read back capped at 24 h.
- **`/data` writes**: a temporary file opened 0600, written, `fsync`ed,
  closed, renamed over the old one, then the directory `fsync`ed when the
  system allows it (as gladys-hubspace).
- **Pauses of every path**, kept in `/data` and read back capped at 6 h (lot
  6 lesson): 429 (`Retry-After` bounded to 1 min – 6 h, 15 min without it),
  403 "Too many failed attempts" of the sign-in (1 h), a 403 of the reads
  that a new sign-in does not cure (1 h). They hold the reads, the commands
  and the buttons, survive restarts, account changes and reconnections. A
  403 of a command is that command refused only.
- **Errors never read again sooner than the interval**: backoff 1, 2, 5, 10,
  then 15 min (all at least the interval); one try per cycle.
- **Reads**: the residences (permissions, then the residence and/or the
  residences of the residential account of each permission, both read when
  a permission holds both; ten at most) every hour, kept when that read
  fails later (unless the session or a pause is the cause); the devices of
  each residence every cycle, one request each, read one by one (review
  I4): a residence in error keeps its last devices (badge unreachable) and
  the others go on; its 401/403 never drops the session nor pauses
  everything. Only when every residence fails is a 401/403 taken as a
  refused token (the full handling: drop, one new sign-in, the reads again;
  a 403 that stays pauses for an hour); a 429 or a missing session ends the
  cycle at once. 60 s by default, 30 to 60 (the brief; homebridge polls every
  30 s). A new socket per request (`agent: false`): no kept-alive socket
  reset by the server.
- **Device ids**: `device:<id>` (the iotSwitch `id`, numbers or
  `[A-Za-z0-9_-]{1,64}`), the id decora-wifi and the Home Assistant
  integrations key on. A device found in two residences is kept once.
- **Kinds**: the model first (schmittx's and homebridge's lists: dimmers ->
  `light/binary` + `light/brightness`; outlets and switches ->
  `switch/binary`), `canSetLevel` for an unknown model, so a device never
  changes kind; an unknown model is shown read only (no command on a guessed
  kind) until it is listed. Fans (DW4SF, D24SF), button controllers (DW4BC),
  the bridge (MLWSB) and the GFCI outlets (D2GF1, D2GF2: a ground-fault
  protection is not a plug to cut from Gladys) are hidden, as any device
  without a `power` state. The
  D2MSD motion dimmer is a light (its motion sensor later). The D2SCS
  (controller + switch) is a switch.
- **Switches and plugs as `switch/binary`, dimmers as `light/binary`** (the
  brief): lights and plugs are what an "everything off" is for; nothing here
  opens, unlocks or cuts a protection. Documented: do not plug in a device
  that must never be cut.
- **Brightness**: 0–100 without unit (the core lists none for `light`), 0
  sends `power: OFF`, any other value `power: ON` with the brightness
  bounded to `minLevel`–`maxLevel` (schmittx sends the power with it).
- **Online**: `unknown/unknown` 0/1 read only (the core has no connectivity
  category), plus the transport badge (unreachable when `connected` is
  false). The power and brightness of an offline device are not published
  (stale), and its commands refused before anything is sent.
- **Consumption**: no power nor energy attribute in any reference for these
  devices: no energy feature, no index.
- **Commands**: one at a time per device (a promise chain that also waits
  for a request finishing in the background), but a command still waiting
  3 s after the click is refused unsent (review I2: Gladys answered within
  its 5 s). Refused unsent too when a sign-in runs (it would leave after it)
  or when less than 300 ms are left. The request carries a send limit (3 s
  after the click): not left by then (`finish` of the request), it is
  destroyed and refused unsent; Gladys is answered "done" at 4.3 s only when
  the request has left (review I1), the request then finishing in the
  background. Sent once, never a sign-in (no session: refused, the cycle
  signs in). The answer of the PUT (else the values sent) is published at
  once without making Gladys wait and held 15 s against an older read; the
  device is read again (`GET /IotSwitches/<id>`) 2 s after the last command.
  A command whose result is unknown (timeout after sending, 5xx, a 200 whose
  body is not the expected JSON or too large) says so, and the device is read
  again. A pause refuses the commands with its own message (429, too many
  sign-ins, 403).
- **Publication never shrinks** (lot 6 lesson): a created device is
  published with its features as Gladys has them (types and ranges fixed at
  creation), plus new ones; a device or feature seen earlier in the run
  stays published. Status, Discovery, badges and states are sent again at
  every `connected` (caches emptied); a reconnection keeps the session, the
  stops and the pauses. Another account (new e-mail) empties the list of
  the previous one: its devices are not published again.
- **Device params**: model, firmware, manufacturer and kind; never the MAC,
  serial number nor local IP.
- **Category `lighting`** in the store.
- **Not checked here (PIPELINE step 1, main session)**: duplicates in the
  store, the core and the forum were checked when the batch was reserved
  (post #241).
