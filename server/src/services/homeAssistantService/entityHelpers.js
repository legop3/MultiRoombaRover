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

function normalizeConfigEntry(entry) {
  if (!entry) return null;
  const id = entry.id || entry.entityId || entry.entity_id;
  if (!id) return null;
  const type = inferType(id, entry.type);
  const name = entry.name || null;
  return { id: String(id), name, type };
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

function buildState(meta, raw) {
  if (!meta) return null;
  const name = meta.name || raw?.attributes?.friendly_name || meta.id;
  const supportedColorModes = Array.isArray(raw?.attributes?.supported_color_modes)
    ? raw.attributes.supported_color_modes.map((mode) => String(mode))
    : [];
  const rgbColor = Array.isArray(raw?.attributes?.rgb_color) ? raw.attributes.rgb_color : null;
  const hsColor = Array.isArray(raw?.attributes?.hs_color) ? raw.attributes.hs_color : null;
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
    colorMode: raw?.attributes?.color_mode || null,
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
