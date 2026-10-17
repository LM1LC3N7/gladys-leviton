# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to My Leviton with the e-mail and password of the app, as
  decora-wifi does it; the token kept in `/data` and reused across cycles and
  restarts, a new sign-in only when it is about to end or is refused (at most
  one per cycle).
- The verification code of two-factor accounts: the integration stops and
  says so; "Verify the code" signs in with it, "Send the verification code"
  makes Leviton e-mail a new one (at most once a minute). An account that
  asks for a code is never signed in again without a click; the code is never
  kept.
- Dimmers (on/off as a light, brightness bounded to the device levels, 0
  turns off), switches and plugs (on/off), and an "Online" state per device;
  fans, button controllers and the bridge are not shown.
- Commands one at a time per device, sent within 3 s of the click or refused
  unsent, Gladys answered within its 5 s, never a sign-in from a command; the
  confirmed value shown at once and held 15 s against a stale read, the
  device read again 2 s after.
- One read per residence every 60 s (30 to 60), the residences every hour.
  Resilience: a refused token signs in once, then a pause and new tries after
  1 h, 6 h, then every 24 h; a refused password stops with new tries after
  6 h then every 24 h; 429, "too many failed attempts" and 403 pause every
  path; these stops and pauses kept in `/data` and capped when read back;
  5xx and network errors retried after 1 to 15 minutes.
- Status, Discovery, badges and states sent again at every reconnection to
  Gladys; the Discovery list never shrinks. Transport badge per device
  (unreachable when Leviton says it is offline).
- Never a sign-in without a click unless the account is known to need no
  code (a sign-in without code accepted before): any other account, or a lost
  `/data`, waits with "Sign-in required"; saving the configuration and the
  buttons count as a click, a reconnection to Gladys does not.
- A command never leaves more than 3 s after the click (queue, sign-in in
  progress, slow network): refused unsent; "done" only once it has left. A
  residence in error keeps its last devices without stopping the others.
  Unknown models read only; GFCI outlets not shown.
- A click (saved configuration, button) allows a sign-in only in the cycle
  it starts: saved during a pause, it never signs in when the pause ends. A
  stop waiting for a click turns the badges unreachable; the devices of a
  residence not read are not sent again (heartbeat included).
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-leviton/commits/main
