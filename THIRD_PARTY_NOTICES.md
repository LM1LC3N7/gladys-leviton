# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the projects below, distributed under
the MIT License, whose notices are reproduced in full as that license asks.

## decora-wifi (python-decora_wifi)

<https://github.com/tlyakhov/python-decora_wifi>, by Tim Lyakhovetskiy, the
library of the `decora_wifi` integration of Home Assistant. MIT License
(`LICENSE` of the repository, default branch read on 2026-10-17).

Ported in `src/constants.js` and `src/client.js`: the host
(`https://my.leviton.com/api`), the sign-in (`POST /Person/login` with the
e-mail and the password, the `id` of the answer used as the `authorization`
header, its `userId`), the residential permissions of the person
(`/Person/<id>/residentialPermissions`), a permission holding a residential
account (`/ResidentialAccounts/<id>/residences`) or a residence itself, the
devices of a residence (`/Residences/<id>/iotSwitches`), the read of one
device and its write (`/IotSwitches/<id>`, `GET` and `PUT` with `power`
`"ON"` / `"OFF"` and `brightness`). Ported in `src/model.js`: the attributes
read (`power`, `brightness`, `minLevel`, `maxLevel`, `canSetLevel`, `name`,
`model`). Changed: no `clientId` / `registeredVia` in the sign-in body (the
newer clients below do not send them), no logout, a 401 never signs in again
from a command, at most one new sign-in per cycle.

```
MIT License

Copyright (c) 2017 Tim Lyakhovetskiy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## home-assistant-leviton-decora-smart-wifi

<https://github.com/schmittx/home-assistant-leviton-decora-smart-wifi>, by Matt
Schmitt, a custom Home Assistant integration for the same cloud. MIT License
(`LICENSE` of the repository, default branch read on 2026-10-17).

Ported in `src/http.js`, `src/client.js` and `src/app.js`: the verification
code (the sign-in answers 406 "Person uses two factor authentication.
Requires code."; the same sign-in sent again with `code`; 408 "Invalid code"),
401 "Login Failed" and 403 "Too many failed attempts", the LoopBack error
envelope (`error.statusCode`, `error.message`), `include=user` on the sign-in.
Ported in `src/constants.js` and `src/devices.js`: the list of models and their
kinds (dimmers, outlets, switches, fans, controllers, the bridge), the power
sent with a brightness. Changed: the code is never kept nor sent again by the
integration (schmittx re-sends the stored one at each sign-in); an account
that asks for a code is never signed in again without a click.

```
MIT License

Copyright (c) 2023 Matt Schmitt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Read, no code taken

- The [`decora_wifi` integration of Home Assistant](https://github.com/home-assistant/core/tree/dev/homeassistant/components/decora_wifi)
  (Apache-2.0): read for the light entities it builds (`canSetLevel`, the
  brightness scaled with `maxLevel`, `minLevel` as the floor).
- [homebridge-myleviton](https://github.com/tbaur/homebridge-myleviton)
  (tbaur, Apache-2.0): read to cross-check the endpoints, the model list, the
  token lifetime (`ttl`, one hour assumed without it), the 30 s polling, the
  bounded answers and the redirects never followed.
