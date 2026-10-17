# Leviton Decora Smart Wi-Fi for Gladys Assistant

Shows and commands in Gladys the **Leviton Decora Smart Wi-Fi** switches,
dimmers and plugs (United States, Canada) of your **My Leviton** account,
through the Leviton cloud.

> **Unofficial API, never tested with a real account.** The integration talks
> to the API of the My Leviton app, which Leviton does not document and may
> change at any time. It was written from the decora-wifi library (the one of
> the Home Assistant integration) and schmittx's Home Assistant integration,
> and tested with made-up answers only. Not affiliated with Leviton.

## What you get

One Gladys device per supported Leviton device:

| Leviton device                       | Gladys features                               |
| ------------------------------------ | --------------------------------------------- |
| Dimmer (DW6HD, D26HD, DW1KD, D2ELV…) | On/Off (light), Brightness (0 to 100), Online |
| Switch (DW15S, D215S…)               | On/Off (switch), Online                       |
| Plug (DW15P, DW15A, D215P, D215O…)   | On/Off (switch), Online                       |

- **Brightness**: 0 turns the light off; any other value turns it on, within
  the minimum and maximum levels set in the app.
- **Online** (1 = yes, read only): what Leviton says of the device. An
  offline device is also marked "unreachable" on its card; its state is not
  shown (it would be stale) and its commands are refused.
- **Consumption**: Leviton gives none for these devices in the known
  libraries: there is none here.
- **Fans** (DW4SF, D24SF), **button controllers** (DW4BC) and the **bridge**
  (MLWSB) are not shown in this version.

Switches, plugs and lights are ordinary Gladys switches: an "everything off"
of Gladys, of a voice assistant or of a scene turns them off too. Do not plug
in a device that must never be cut.

## Setup

1. In Gladys, install the **Leviton Decora Smart Wi-Fi** integration from the
   store.
2. Enter the **e-mail** and **password** of your My Leviton account (the ones
   of the app), then save.
3. If the status says a verification code is asked, see below.
4. Open the **Discovery** tab and add the devices.

The password field is a `secret` field: Gladys keeps it in its database (in
clear, as any configuration value, and in its backups), never shows it again,
and the integration sends it only to My Leviton (`my.leviton.com`). It is used
for the sign-ins only: the session obtained is kept and reused at every read
and after a restart, until it ends.

### Verification code (two-factor authentication)

If your My Leviton account uses two-factor authentication, Leviton e-mails a
code at each sign-in without code. The integration then stops and the status
says so:

1. Under **Verify the code**, type the code of the last Leviton e-mail and
   click the button. "Code accepted" means connected.
2. No e-mail, or the code is too old? Click **Send the verification code**:
   the integration signs in without code and Leviton e-mails a new one (at
   most once a minute).

The integration never sends a code without your click, never keeps it, and
never signs in again by itself for an account that asks for a code: the
session is kept as long as Leviton accepts it; when it refuses it, the
integration stops and asks you for a code again. At most one automatic
e-mail, at the very first sign-in.

## Refresh

The devices are read every **60 seconds** by default (30 to 60, _Refresh
interval_), **one request per residence**; the list of residences is read
again every hour.

A command leaves at once; the value Leviton confirms is shown at once, the
device is read again 2 seconds later, and a slightly late read does not undo
the commanded value (15 seconds). The commands of one device go one after
the other. Gladys waits 5 seconds for the answer: a command that cannot leave
within 3 seconds is refused **before it is sent**; a command sent but slow is
answered at 4.3 seconds and its effect shows afterwards.

## Troubleshooting

- **E-mail or password refused**: the integration stops, even after a
  restart, and tries again once after 6 hours then every 24 hours (never for
  an account that asks for a code). Fix them and save, or click _Test the
  connection_.
- **Too many failed sign-ins** (refused by Leviton): a one-hour pause,
  commands and buttons included, kept after a restart.
- **Session refused**: one single new sign-in; refused again, the
  integration pauses and tries again after 1 hour, 6 hours, then every 24
  hours. _Test the connection_ tries again at once.
- **Too many requests (429)**: a pause of 1 minute to 6 hours (Leviton's
  `Retry-After`, 15 minutes without it), for the reads, the commands and the
  buttons, kept after a restart or a reconnection to Gladys. **HTTP 403** of
  the reads: one hour.
- **Leviton unavailable (5xx, network)**: new tries after 1, 2, 5, 10, then
  every 15 minutes, never sooner than the interval.

## Limits

- Unofficial API: Leviton may change it, block it or ask for more checks.
- No live updates (the websocket of the app): one read every 30 to 60
  seconds.
- One My Leviton account per Gladys, ten residences at most.
- No fans, no motion sensor (D2MSD: the light only), no scenes, schedules nor
  settings (LEDs, fade…) in this version.
- Never tested with a real account: please report what you see on the
  [GitHub repository](https://github.com/LM1LC3N7/gladys-leviton/issues)
  (without your e-mail, password or codes).

## Privacy

The integration keeps in `/data/leviton-state.json` (readable by its own
container only): the session token, the Leviton user id and the end of the
token, the account they belong to as a hash of the e-mail, the accounts
(hashes) that ask for a code, the time of the last code request, the end of a
pause, and a stop on refused credentials tied to a salted fingerprint of the
e-mail and password. Neither the e-mail, the password nor the codes. The MAC
address, serial number and local IP address of the devices are not sent to
Gladys. Nothing is sent anywhere but to My Leviton.
