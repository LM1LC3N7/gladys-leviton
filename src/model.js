// -----------------------------------------------------------------------------
// My Leviton answers -> plain devices (pure). An `iotSwitch` of decora-wifi:
// `id`, `name`, `model`, `power` ("ON" / "OFF"), `brightness` (0-100),
// `minLevel`, `maxLevel`, `canSetLevel`, `connected`, `version`,
// `manufacturer`. Nothing is guessed: a value that is missing or out of its
// range stays unknown.
// -----------------------------------------------------------------------------

import { idOf } from './client.js';
import { LIMITS, MODELS } from './constants.js';

const text = (value) =>
  typeof value === 'string' && value.trim() !== ''
    ? value
        // eslint-disable-next-line no-control-regex -- control characters are what is removed
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, LIMITS.textLength)
    : undefined;

const level = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : undefined;

const POWER = { ON: 1, OFF: 0 };

/**
 * What a device becomes in Gladys: `dimmer` (a light with a brightness),
 * `outlet` or `switch` (an on/off), or undefined when it is not shown (fans,
 * button controllers, the bridge, a device without a power state). The model
 * decides first, so that a device keeps its kind; `canSetLevel` decides for an
 * unknown model (shown read only, see `knownModel`).
 */
export function kindOf(raw) {
  const model = text(raw?.model)?.toUpperCase();
  if (model && MODELS.hidden.has(model)) {
    return undefined;
  }
  if (!Object.hasOwn(POWER, String(raw?.power))) {
    return undefined;
  }
  if (model && MODELS.dimmers.has(model)) {
    return 'dimmer';
  }
  if (model && MODELS.outlets.has(model)) {
    return 'outlet';
  }
  if (model && MODELS.switches.has(model)) {
    return 'switch';
  }
  return raw?.canSetLevel === true ? 'dimmer' : 'switch';
}

/** Whether the model is one of the lists: an unknown one is shown read only. */
export function knownModel(raw) {
  const model = text(raw?.model)?.toUpperCase();
  return Boolean(
    model && (MODELS.dimmers.has(model) || MODELS.outlets.has(model) || MODELS.switches.has(model)),
  );
}

/** One `iotSwitch` -> a device, or undefined when it has no usable id. */
export function readSwitch(raw) {
  const id = idOf(raw?.id);
  if (!id || raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const model = text(raw.model);
  const minLevel = level(raw.minLevel);
  const maxLevel = level(raw.maxLevel);
  return {
    id,
    name: text(raw.name) ?? `Leviton ${model ?? id}`,
    model,
    version: text(raw.version),
    manufacturer: text(raw.manufacturer),
    kind: kindOf(raw),
    known: knownModel(raw),
    power: POWER[String(raw.power)],
    brightness: level(raw.brightness),
    minLevel: minLevel !== undefined && minLevel >= 1 ? minLevel : 1,
    maxLevel: maxLevel !== undefined && maxLevel >= 1 ? maxLevel : 100,
    online: typeof raw.connected === 'boolean' ? raw.connected : undefined,
  };
}

/** Every device of the residences read, by id (the first one wins on a duplicate). */
export function readDevices(lists) {
  const devices = new Map();
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const device = readSwitch(raw);
      if (device && !devices.has(device.id)) {
        devices.set(device.id, device);
      }
    }
  }
  return devices;
}

/**
 * A device after an answer of Leviton about it (a command's echo, a read
 * again): only the values it carries change; its kind stays.
 */
export function withAnswer(device, raw) {
  const fresh = readSwitch({ ...raw, id: raw?.id ?? device.id });
  if (!fresh || fresh.id !== device.id) {
    return device;
  }
  const has = (key) => raw && Object.prototype.hasOwnProperty.call(raw, key);
  return {
    ...device,
    power: has('power') && fresh.power !== undefined ? fresh.power : device.power,
    brightness:
      has('brightness') && fresh.brightness !== undefined ? fresh.brightness : device.brightness,
    minLevel: has('minLevel') ? fresh.minLevel : device.minLevel,
    maxLevel: has('maxLevel') ? fresh.maxLevel : device.maxLevel,
    online: has('connected') && fresh.online !== undefined ? fresh.online : device.online,
  };
}
