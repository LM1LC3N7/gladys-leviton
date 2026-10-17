// -----------------------------------------------------------------------------
// A Leviton device -> one Gladys device: its features, how each one is read,
// and how a command becomes the body of `PUT /IotSwitches/<id>` (pure).
//
// External ids: `ext:<selector>:device:<Leviton id>` (the `id` of the
// iotSwitch, the one decora-wifi and the Home Assistant integration key the
// device on), features by role: `power`, `brightness`, `online`. Never change
// how they are built.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, word } from './i18n.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** The value of a feature while the device is online (a state of an offline one is stale). */
const live = (device, value) => (device.online === false ? undefined : value);

const online = {
  key: 'online',
  name: 'online',
  category: C.UNKNOWN,
  type: T.UNKNOWN.UNKNOWN,
  min: 0,
  max: 1,
  read: (d) => (d.online === undefined ? undefined : d.online ? 1 : 0),
};

const onOff = (v) => {
  if (v !== 0 && v !== 1) {
    return { refuse: 'invalidValue' };
  }
  return { power: v === 1 ? 'ON' : 'OFF' };
};

function dimmerSpecs() {
  return [
    {
      key: 'power',
      name: 'power',
      category: C.LIGHT,
      type: T.LIGHT.BINARY,
      min: 0,
      max: 1,
      read: (d) => live(d, d.power),
      write: (v) => onOff(v),
    },
    {
      key: 'brightness',
      name: 'brightness',
      category: C.LIGHT,
      type: T.LIGHT.BRIGHTNESS,
      min: 0,
      max: 100,
      read: (d) => live(d, d.brightness),
      // 0 turns the light off; otherwise on, within the device's levels
      // (schmittx sends the power with the brightness).
      write: (v, d) => {
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return { refuse: 'invalidValue' };
        }
        if (Math.round(v) <= 0) {
          return { power: 'OFF' };
        }
        return { power: 'ON', brightness: clamp(Math.round(v), d.minLevel, d.maxLevel) };
      },
    },
    online,
  ];
}

function switchSpecs() {
  return [
    {
      key: 'power',
      name: 'power',
      category: C.SWITCH,
      type: T.SWITCH.BINARY,
      min: 0,
      max: 1,
      read: (d) => live(d, d.power),
      write: (v) => onOff(v),
    },
    online,
  ];
}

/**
 * The features of a device: `{ kind, specs, readOnly }`, or undefined when it
 * is not shown. A model missing from the lists is shown read only: nothing is
 * commanded on a device whose kind is only guessed.
 */
export function planOf(device) {
  let specs;
  switch (device.kind) {
    case 'dimmer':
      specs = dimmerSpecs();
      break;
    case 'switch':
    case 'outlet':
      specs = switchSpecs();
      break;
    default:
      return undefined;
  }
  if (!device.known) {
    specs = specs.map(({ write: _write, ...spec }) => spec);
  }
  return { kind: device.kind, specs, readOnly: !device.known };
}

export const deviceIds = (gladys, id) => gladys.externalIds('device', id);

/** The Gladys device of a Leviton device and its plan. */
export function buildDevice(gladys, device, plan, language) {
  const ids = deviceIds(gladys, device.id);
  const params = [
    ['model', device.model],
    ['firmware', device.version],
    ['manufacturer', device.manufacturer],
    ['leviton_kind', plan.kind],
  ]
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .map(([name, v]) => ({ name, value: v.slice(0, 100) }));
  return {
    name: device.name,
    external_id: ids.device,
    should_poll: false,
    params,
    features: plan.specs.map((spec) => ({
      name: word(FEATURE_NAMES[spec.name], language).slice(0, 100),
      external_id: ids.feature(spec.key),
      category: spec.category,
      type: spec.type,
      min: spec.min,
      max: spec.max,
      read_only: !spec.write,
      has_feedback: true,
      keep_history: true,
    })),
  };
}

/** The current values of a device: `[{ device_feature_external_id, state }]`. */
export function deviceStates(gladys, device, plan) {
  const ids = deviceIds(gladys, device.id);
  const states = [];
  for (const spec of plan.specs) {
    const v = spec.read(device);
    if (typeof v === 'number' && Number.isFinite(v)) {
      states.push({ device_feature_external_id: ids.feature(spec.key), state: v });
    }
  }
  return states;
}
