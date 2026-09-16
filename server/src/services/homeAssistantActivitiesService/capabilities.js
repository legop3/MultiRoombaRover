// Turn HA's service descriptions into reusable input descriptors. Selectors,
// targets, and feature filters come from HA; only irregular state-attribute
// names need translations here (the same boundary HA's frontend has).
const humanize = (value) => {
  const text = String(value || '').replace(/_/g, ' ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};
const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = (value) => Array.isArray(value) ? value : [value];

// These are protocol naming differences, not device models or feature flags.
// Option contents, limits, and capabilities always come from the live entity.
const STATE_ATTRIBUTES = {
  direction: 'current_direction', position: 'current_position', tilt_position: 'current_tilt_position',
  seek_position: 'media_position', brightness_pct: 'brightness',
};
const OPTIONS_ATTRIBUTES = {
  speed: 'supported_speeds', mode: 'available_modes', effect: 'effect_list', source: 'source_list', sound_mode: 'sound_mode_list',
  fan_speed: 'fan_speed_list', activity: 'activity_list', operation_mode: 'operation_list',
};

function matchesFilter(filter, domain, attributes) {
  if (!filter) return true;
  if (Array.isArray(filter)) return filter.some((entry) => matchesFilter(entry, domain, attributes));
  // Service target selectors can wrap their constraints in `filter`. Reject
  // registry-only constraints we cannot verify from this entity's snapshot.
  if (filter.filter && !matchesFilter(filter.filter, domain, attributes)) return false;
  if (filter.integration || filter.device || filter.manufacturer || filter.model) return false;
  if (filter.domain && !list(filter.domain).includes(domain)) return false;
  if (filter.device_class && !list(filter.device_class).includes(attributes.device_class)) return false;
  if (filter.supported_features !== undefined) {
    const supported = Number(attributes.supported_features || 0);
    const groups = list(filter.supported_features);
    // HA defines an outer OR and an inner AND. Numeric masks are supplied by
    // get_services, so there is no duplicated table of per-domain feature bits.
    if (!groups.some((group) => list(group).every((flag) => (
      typeof flag === 'number' && (supported & flag) === flag
    )))) return false;
  }
  if (filter.attribute) {
    return Object.entries(filter.attribute).every(([key, expected]) => (
      list(attributes[key]).some((value) => list(expected).includes(value))
    ));
  }
  return true;
}

function flattenFields(fields = {}, advanced = false) {
  // Field sections only affect HA's presentation; service payloads stay flat.
  return Object.entries(fields).flatMap(([key, field]) => (
    field.fields ? flattenFields(field.fields, advanced || field.collapsed === true) : [{ key, advanced, ...field }]
  ));
}

function fieldState(domain, key, selector, raw) {
  const attributes = raw?.attributes || {};
  const attribute = selector.state?.attribute || STATE_ATTRIBUTES[key] || key;
  if (key === 'value' || key === 'option' || key === 'hvac_mode') return raw?.state ?? null;
  if (domain === 'water_heater' && key === 'operation_mode') return raw?.state ?? null;
  if (domain === 'input_datetime' && ['date', 'time', 'datetime'].includes(key)) {
    if (key === 'date') return raw?.state?.split(' ')[0] ?? null;
    if (key === 'time') return raw?.state?.split(' ').at(-1) ?? null;
    return raw?.state?.replace(' ', 'T') ?? null;
  }
  if (key === 'brightness_pct') return numberOrNull(attributes.brightness) === null ? null : Math.round(attributes.brightness / 255 * 100);
  return attributes[attribute] ?? null;
}

function fieldOptions(key, selector, attributes) {
  const explicit = selector.select?.options || selector.state?.extra_options;
  const attribute = selector.state?.attribute || key;
  // Most domains use a plural attribute. The handful of irregular list names
  // are shared conventions, and still resolve their values from the device.
  const dynamic = attributes[OPTIONS_ATTRIBUTES[attribute]] || attributes[`${attribute}s`]
    || (['value', 'option'].includes(key) ? attributes.options : null);
  return list(explicit || dynamic || []).filter((entry) => (
    ['string', 'number', 'boolean'].includes(typeof entry) || (entry && Object.hasOwn(entry, 'value'))
  )).map((entry) => typeof entry === 'object'
    ? { value: entry.value, label: String(entry.label ?? entry.value) }
    : { value: entry, label: String(entry) })
    .filter((entry) => !selector.state?.hide_states?.includes(entry.value));
}

function describeField(domain, field, raw) {
  const attributes = raw?.attributes || {};
  const { key } = field;
  // Native number entities advertise a text selector for set_value even
  // though their entity attributes supply the actual numeric contract.
  const selector = key === 'value' && ['number', 'input_number'].includes(domain)
    ? { number: field.selector?.number || {} } : field.selector || {};
  const state = fieldState(domain, key, selector, raw);
  const base = { key, name: field.name || humanize(key), required: Boolean(field.required), advanced: Boolean(field.advanced), state, default: field.default };
  const options = fieldOptions(key, selector, attributes);
  // Multiple values and structured selectors need a compound editor. Do not
  // pretend a text box can faithfully represent an arbitrary HA object.
  if (Object.values(selector).some((settings) => settings?.multiple)) return null;
  if ('constant' in selector && selector.constant) return { ...base, type: 'button', constant: selector.constant.value, name: selector.constant.label || base.name };
  if ('boolean' in selector) return { ...base, type: 'toggle' };
  if ('select' in selector || 'state' in selector) {
    if (options.length) return { ...base, type: 'select', options };
    // HA's state selector also permits typed values when no option list is
    // published. A string input is faithful to that selector, unlike guessing
    // that an arbitrary attribute or structured object is writable text.
    return 'state' in selector ? { ...base, type: 'text', min: null, max: null } : null;
  }
  if ('number' in selector || 'color_temp' in selector) {
    const settings = selector.number || selector.color_temp || {};
    let min = numberOrNull(settings.min);
    let max = numberOrNull(settings.max);
    let step = numberOrNull(settings.step);
    let unit = settings.unit_of_measurement || '';
    // Entity limits override broad service-wide ranges: two thermostats or
    // number helpers can support very different limits under the same action.
    if (key === 'value') {
      min = numberOrNull(attributes.min) ?? min;
      max = numberOrNull(attributes.max) ?? max;
      step = numberOrNull(attributes.step) ?? step;
      unit = attributes.unit_of_measurement || unit;
    } else if (['temperature', 'target_temp_high', 'target_temp_low'].includes(key)) {
      min = numberOrNull(attributes.min_temp) ?? min;
      max = numberOrNull(attributes.max_temp) ?? max;
      step = numberOrNull(attributes.target_temp_step) ?? step;
    } else if (key === 'humidity') {
      min = numberOrNull(attributes.min_humidity) ?? min;
      max = numberOrNull(attributes.max_humidity) ?? max;
    } else if (key === 'color_temp_kelvin') {
      min = numberOrNull(attributes.min_color_temp_kelvin) ?? min;
      max = numberOrNull(attributes.max_color_temp_kelvin) ?? max;
      unit = 'K';
    } else if (key === 'percentage') {
      step = numberOrNull(attributes.percentage_step) ?? step;
    } else if (key === 'seek_position') {
      max = numberOrNull(attributes.media_duration) ?? max;
      unit = 's';
    }
    return { ...base, type: 'number', min, max, step, unit };
  }
  if ('text' in selector) {
    return { ...base, type: 'text', min: key === 'value' ? numberOrNull(attributes.min) : null,
      max: key === 'value' ? numberOrNull(attributes.max) : null,
      password: selector.text?.type === 'password' || attributes.mode === 'password' };
  }
  if ('color_rgb' in selector) return { ...base, type: 'color' };
  for (const type of ['date', 'time', 'datetime']) {
    if (type in selector) return { ...base, type };
  }
  return null;
}

function targetsDomain(filter, domain) {
  if (Array.isArray(filter)) return filter.some((entry) => targetsDomain(entry, domain));
  return Boolean(filter && (list(filter.domain).includes(domain) || targetsDomain(filter.filter, domain)));
}

function describeActions(entityId, raw, services) {
  const domain = entityId.split('.')[0];
  const attributes = raw?.attributes || {};
  const actions = [];
  const unsupported = [];
  for (const [serviceDomain, entries] of Object.entries(services || {})) {
    for (const [service, description] of Object.entries(entries)) {
      const target = description.target?.entity;
      const targetFields = description.fields?.entity_id?.selector?.entity;
      // Only entity-targeted actions belong here. In particular, domain-wide
      // reloads must not appear as buttons just because their domain matches.
      if (!description.target && !targetFields) continue;
      if (!target && !targetFields && (description.target?.device || description.target?.area)) continue;
      const filter = target || targetFields;
      if (serviceDomain !== domain && !filter) continue;
      if (serviceDomain !== domain && !targetsDomain(filter, domain)) continue;
      if (!matchesFilter(filter, domain, attributes)) continue;
      if (description.response?.optional === false) continue;
      const fields = [];
      let unsupportedRequired = false;
      for (const field of flattenFields(description.fields)) {
        if (field.key === 'entity_id' || field.key === 'device_id' || field.key === 'area_id') continue;
        if (!matchesFilter(field.filter, domain, attributes)) continue;
        const descriptor = describeField(domain, field, raw);
        if (descriptor) fields.push(descriptor);
        else {
          if (field.required) unsupportedRequired = true;
        }
      }
      const action = { id: `${serviceDomain}.${service}`, domain: serviceDomain, service,
        name: description.name || humanize(service), fields };
      if (unsupportedRequired) {
        unsupported.push(action.name);
        continue;
      }
      // Temperature-range writes need both ends together even though the HA
      // service declares them optional to also support single-target devices.
      if (fields.some((field) => field.key === 'target_temp_high') && fields.some((field) => field.key === 'target_temp_low')) {
        fields.forEach((field) => {
          if (field.key === 'target_temp_high' || field.key === 'target_temp_low') field.required = true;
        });
      }
      actions.push(action);
    }
  }
  // Prefer a dedicated setter over the same optional field on turn_on or a
  // compound action. Both remain valid server-side actions, but the card only
  // needs one speed/preset/mode input instead of duplicate copies.
  for (const action of actions) {
    action.fields.forEach((field) => {
      field.hidden = !field.required && actions.some((other) => other !== action
        && other.fields.length === 1 && other.fields[0].key === field.key);
    });
  }
  return { actions, unsupported };
}

module.exports = { describeActions, matchesFilter, humanize };
