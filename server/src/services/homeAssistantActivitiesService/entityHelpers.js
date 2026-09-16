// Public activity state consists of an entity plus its discovered actions. The
// same descriptors drive rendering and server validation so clients cannot add
// writable attributes or arbitrary HA targets of their own.
const { describeActions, humanize } = require('./capabilities');

function buildEntity(item, raw, services, locked = false) {
  const attributes = raw?.attributes || {};
  const { actions, unsupported } = item.readOnly ? { actions: [], unsupported: [] } : describeActions(item.id, raw, services);
  return {
    id: item.id, name: item.name?.trim() || attributes.friendly_name || item.id,
    icon: item.icon || '', color: item.color || '', locked, readOnly: Boolean(item.readOnly),
    // Unknown is a legitimate initial state for press-only and stateless
    // entities. Missing entities and explicit unavailable states disable input.
    available: Boolean(raw && raw.state !== 'unavailable'),
    state: raw?.state ?? 'unknown', unit: attributes.unit_of_measurement || '',
    password: attributes.mode === 'password', actions, unsupported,
    // Scalar attributes remain inspectable without interpreting them as writable
    // properties. Lists/objects used for capability metadata are not dumped into
    // the compact tile, and sensitive text values are not echoed as details.
    details: Object.entries(attributes).filter(([key, value]) => (
      !['friendly_name', 'icon', 'supported_features', 'unit_of_measurement', 'mode'].includes(key)
      && !key.startsWith('min_') && !key.startsWith('max_')
      && ['string', 'number', 'boolean'].includes(typeof value) && attributes.mode !== 'password'
    )).map(([key, value]) => ({ name: humanize(key), value: String(value) })),
  };
}

function normalizeValue(field, value) {
  switch (field.type) {
    case 'toggle':
      if (typeof value !== 'boolean') throw new Error(`${field.name}: expected a boolean`);
      return value;
    case 'number': {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error(`${field.name}: enter a number`);
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`${field.name}: enter a finite number`);
      if ((field.min !== null && number < field.min) || (field.max !== null && number > field.max)) throw new Error(`${field.name}: value is outside the allowed range`);
      // Step controls slider granularity, not a universal service constraint.
      // HA owns quantization (for example a three-speed fan reports rounded
      // percentages while advertising a fractional percentage_step).
      return number;
    }
    case 'select':
      if (!field.options.some((option) => option.value === value)) throw new Error(`${field.name}: choose an available option`);
      return value;
    case 'text': {
      if (typeof value !== 'string') throw new Error(`${field.name}: expected text`);
      const length = Array.from(value).length;
      if (length < (field.min ?? 0) || (field.max !== null && length > field.max)) throw new Error(`${field.name}: text is outside the allowed length`);
      return value;
    }
    case 'color':
      if (!Array.isArray(value) || value.length !== 3 || value.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) throw new Error(`${field.name}: expected RGB color`);
      return value;
    case 'button':
      if (value !== field.constant) throw new Error(`${field.name}: invalid constant`);
      return value;
    case 'date':
    case 'time':
    case 'datetime':
      // Native browser pickers send strings. HA owns calendar/time validation
      // and timezone interpretation instead of a second date parser here.
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${field.name}: enter a ${field.type}`);
      return value;
    default:
      throw new Error('Unsupported input');
  }
}

function buildCommand(entity, actionId, values = {}) {
  if (entity.readOnly) throw new Error('This item is read-only');
  const action = entity.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error('This action is not available for the entity');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Expected action fields');
  const data = {};
  // Never forward arbitrary data, especially entity_id/device_id/area_id: only
  // the selected action's currently supported fields can reach the HA service.
  for (const [key, value] of Object.entries(values)) {
    const field = action.fields.find((candidate) => candidate.key === key);
    if (!field) throw new Error(`Unknown action field: ${key}`);
    data[key] = normalizeValue(field, value);
  }
  for (const field of action.fields) {
    if (field.required && !Object.hasOwn(data, field.key)) throw new Error(`${field.name} is required`);
  }
  return { domain: action.domain, service: action.service, data: { ...data, entity_id: entity.id } };
}

module.exports = { buildEntity, buildCommand };
