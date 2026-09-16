// Only these domains have a known write contract. All other entities retain
// their actual state as read-only text instead of being coerced to on/off.
const TYPES = {
  light: 'toggle', switch: 'toggle', input_boolean: 'toggle',
  number: 'number', input_number: 'number', text: 'text', input_text: 'text',
  select: 'select', input_select: 'select', button: 'button', input_button: 'button',
};

function buildEntity(item, raw, locked = false) {
  const attributes = raw?.attributes || {};
  const domain = item.id.split('.')[0];
  const type = item.readOnly ? 'readOnly' : TYPES[domain] || 'readOnly';
  // A never-pressed button legitimately reports unknown. Its state is a last
  // press timestamp, not availability or a boolean toggle state.
  const available = Boolean(raw && raw.state !== 'unavailable' && (raw.state !== 'unknown' || type === 'button'));
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    id: item.id, name: item.name?.trim() || attributes.friendly_name || item.id,
    icon: item.icon || '', domain, type, locked, available,
    state: raw?.state ?? 'unknown', unit: attributes.unit_of_measurement || '',
    min: numeric(attributes.min), max: numeric(attributes.max), step: numeric(attributes.step),
    options: Array.isArray(attributes.options) ? attributes.options.filter((option) => typeof option === 'string') : [],
    password: attributes.mode === 'password',
  };
}

function buildCommand(entity, value) {
  const data = { entity_id: entity.id };
  // Explicit state writes avoid racing a server-side toggle against another
  // user's click. Each branch validates the current HA metadata, not the UI.
  switch (entity.type) {
    case 'toggle':
      if (value !== 'on' && value !== 'off') throw new Error('Expected on or off');
      return { service: value === 'on' ? 'turn_on' : 'turn_off', data };
    case 'button':
      if (value !== 'press') throw new Error('Expected press');
      return { service: 'press', data };
    case 'number': {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error('Enter a number');
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error('Enter a finite number');
      if (entity.min === null || entity.max === null) throw new Error('Number limits are unavailable');
      if (number < entity.min || number > entity.max) throw new Error(`Value must be between ${entity.min} and ${entity.max}`);
      // Use a tolerance for decimal steps because binary floating point cannot
      // exactly represent values such as 0.1. The range is still checked above.
      if (entity.step > 0) {
        const steps = (number - entity.min) / entity.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error(`Value must use steps of ${entity.step}`);
      }
      return { service: 'set_value', data: { ...data, value: number } };
    }
    case 'text': {
      if (typeof value !== 'string') throw new Error('Expected text');
      const length = Array.from(value).length;
      if (length < (entity.min ?? 0) || length > (entity.max ?? 255)) throw new Error('Text is outside the allowed length');
      // Keep type/length checks here; HA owns integration-specific text rules
      // so its patterns are not reinterpreted by a different regex engine.
      return { service: 'set_value', data: { ...data, value } };
    }
    case 'select':
      if (!entity.options.includes(value)) throw new Error('Choose an available option');
      return { service: 'select_option', data: { ...data, option: value } };
    default:
      throw new Error('This item is read-only');
  }
}

module.exports = { buildEntity, buildCommand };
