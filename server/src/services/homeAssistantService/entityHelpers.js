// Home Assistant Entity Helpers
// Purpose: Normalizes Home Assistant entity/button config and converts raw snapshots into stable UI state records.
// Scope: Provides pure helper logic for config loading, entity typing, and state-shape generation.
function inferType(entityId, explicitType) {
  if (explicitType === 'light' || explicitType === 'switch') {
    return explicitType;
  }
  const domain = String(entityId || '').split('.')[0];
  if (domain === 'light') return 'light';
  return 'switch';
}

function inferDomain(entityId) {
  const domain = String(entityId || '').split('.')[0].trim().toLowerCase();
  return domain || 'switch';
}

function normalizeConfigEntry(entry) {
  if (!entry) return null;
  const id = entry.id || entry.entityId || entry.entity_id;
  if (!id) return null;
  const type = inferType(id, entry.type);
  const domain = inferDomain(id);
  const name = entry.name || null;
  return { id: String(id), name, type, domain };
}

function normalizeTriggerEntry(entry, index) {
  if (!entry || typeof entry !== 'object') return null;
  const action = String(entry.action || '').trim();
  if (!action) return null;
  const entityId = String(entry.entityId || entry.entity_id || '').trim();
  if (!entityId) return null;
  const stateEqualsRaw = entry.stateEquals ?? entry.state_equals;
  const stateEquals =
    stateEqualsRaw === null || stateEqualsRaw === undefined ? null : String(stateEqualsRaw).trim();
  const runtimeKey = `${action}::entity::${entityId}::${stateEquals || '*'}::${index}`;
  const cooldownMs = Number.isFinite(Number(entry.cooldownMs)) ? Math.max(0, Number(entry.cooldownMs)) : 0;
  const allowedModes = Array.isArray(entry.allowedModes)
    ? entry.allowedModes.map((mode) => String(mode || '').trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    runtimeKey,
    entityId,
    action,
    stateEquals,
    payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
    cooldownMs,
    allowedModes,
  };
}

function clampByte(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(255, Math.round(numeric)));
}

function byteToHex(value) {
  return clampByte(value).toString(16).padStart(2, '0');
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  return `#${byteToHex(rgb[0])}${byteToHex(rgb[1])}${byteToHex(rgb[2])}`;
}

function hsToRgb(hsColor) {
  if (!Array.isArray(hsColor) || hsColor.length < 2) return null;
  const rawHue = Number(hsColor[0]);
  const rawSaturation = Number(hsColor[1]);
  if (!Number.isFinite(rawHue) || !Number.isFinite(rawSaturation)) return null;

  // Home Assistant's hs_color is hue in degrees plus saturation as 0-100.
  // Brightness is not part of this attribute, so the UI color preview uses full
  // value. When HA also provides rgb_color, rgb_color wins because it carries
  // the already-resolved device color.
  const hue = ((rawHue % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, rawSaturation)) / 100;
  const value = 1;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - chroma;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = chroma;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = chroma;
  } else if (hue < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return [
    clampByte((r + m) * 255),
    clampByte((g + m) * 255),
    clampByte((b + m) * 255),
  ];
}

function colorHexFromAttributes(attributes = {}) {
  const rgbColor = Array.isArray(attributes.rgb_color) ? attributes.rgb_color : null;
  if (rgbColor) {
    return rgbToHex(rgbColor);
  }
  const hsColor = Array.isArray(attributes.hs_color) ? attributes.hs_color : null;
  if (hsColor) {
    return rgbToHex(hsToRgb(hsColor));
  }
  return null;
}

function buildState(meta, raw) {
  if (!meta) return null;
  const name = meta.name || raw?.attributes?.friendly_name || meta.id;
  const attributes = raw?.attributes || {};
  const supportedColorModes = Array.isArray(raw?.attributes?.supported_color_modes)
    ? raw.attributes.supported_color_modes.map((mode) => String(mode))
    : [];
  const rgbColor = Array.isArray(attributes.rgb_color) ? attributes.rgb_color : null;
  const hsColor = Array.isArray(attributes.hs_color) ? attributes.hs_color : null;
  const colorHex = colorHexFromAttributes(attributes);
  const supportsColor =
    meta.type === 'light' &&
    (rgbColor || hsColor || supportedColorModes.some((mode) => mode === 'hs' || mode === 'rgb' || mode === 'xy'));

  if (!raw) {
    return {
      id: meta.id,
      name,
      type: meta.type,
      state: 'unknown',
      available: false,
      lastChanged: null,
      lastUpdated: null,
      supportedColorModes,
      colorMode: null,
      colorHex: null,
      rgbColor: null,
      hsColor: null,
      supportsColor,
    };
  }

  const rawState = raw.state;
  const unavailable = rawState === 'unavailable' || rawState === 'unknown';
  const state = unavailable ? 'unavailable' : rawState === 'on' ? 'on' : 'off';
  return {
    id: meta.id,
    name,
    type: meta.type,
    state,
    available: !unavailable,
    lastChanged: raw.last_changed || null,
    lastUpdated: raw.last_updated || null,
    supportedColorModes,
    colorMode: attributes.color_mode || null,
    colorHex,
    rgbColor,
    hsColor,
    supportsColor,
  };
}

module.exports = {
  normalizeConfigEntry,
  normalizeTriggerEntry,
  buildState,
};
