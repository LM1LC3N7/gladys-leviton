// -----------------------------------------------------------------------------
// Made-up My Leviton data, shaped like the iotSwitch models of decora-wifi and
// the device attributes read by the Home Assistant integrations (schmittx).
// Never real accounts nor real devices.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'correct horse battery staple';
export const CODE = '482913';
export const USER_ID = 4242;
export const ACCOUNT_ID = 77;
export const RESIDENCES = { home: 1001, cabin: 1002 };

export const IDS = {
  dimmer: '501',
  switch: '502',
  outlet: '503',
  fan: '504',
  controller: '505',
  unknownDimmer: '506',
  cabin: '601',
};

const common = {
  manufacturer: 'Leviton Manufacturing Co., Inc.',
  mac: '00:11:22:33:44:55',
  serial: '1000000ABC',
  localIP: '192.0.2.10',
  version: '1.5.72',
};

export function homeDevices() {
  return [
    {
      ...common,
      id: 501,
      name: 'Kitchen',
      model: 'DW6HD',
      power: 'ON',
      brightness: 75,
      minLevel: 10,
      maxLevel: 100,
      canSetLevel: true,
      connected: true,
      residenceId: RESIDENCES.home,
    },
    {
      ...common,
      id: 502,
      name: 'Porch',
      model: 'DW15S',
      power: 'OFF',
      canSetLevel: false,
      connected: true,
      residenceId: RESIDENCES.home,
    },
    {
      ...common,
      id: 503,
      name: 'Lamp',
      model: 'DW15P',
      power: 'ON',
      canSetLevel: false,
      connected: false,
      residenceId: RESIDENCES.home,
    },
    {
      ...common,
      id: 504,
      name: 'Ceiling fan',
      model: 'DW4SF',
      power: 'ON',
      brightness: 50,
      canSetLevel: true,
      connected: true,
      residenceId: RESIDENCES.home,
    },
    {
      ...common,
      id: 505,
      name: 'Scene remote',
      model: 'DW4BC',
      connected: true,
      residenceId: RESIDENCES.home,
    },
    {
      ...common,
      id: 506,
      name: 'Hallway',
      model: 'D9XYZ',
      power: 'OFF',
      brightness: 30,
      canSetLevel: true,
      connected: true,
      residenceId: RESIDENCES.home,
    },
  ];
}

export function cabinDevices() {
  return [
    {
      ...common,
      id: 601,
      name: 'Cabin light',
      model: 'D215S',
      power: 'OFF',
      canSetLevel: false,
      connected: true,
      residenceId: RESIDENCES.cabin,
    },
  ];
}
