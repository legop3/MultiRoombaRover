const { resolveConfiguredEntity } = require('./haEntityLookup');

function normalizeColorHex(value) {
  const raw = String(value || '').trim();
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;

  // Overseer tool calls should be strict here because invalid color strings
  // otherwise travel all the way to the Home Assistant runtime before failing.
  // Keeping the accepted format to CSS-style hex also gives the model one clear
  // representation to use instead of making it choose between RGB, HSL, names,
  // or Home Assistant-specific payloads.
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(withoutHash)) {
    throw new Error('ha_set_light_color requires args.color_hex as #rgb or #rrggbb');
  }

  // Expand shorthand colors before handing them to the shared HA service so
  // logs, downstream payloads, and future tool results all use the same stable
  // six-digit color shape.
  const expanded =
    withoutHash.length === 3
      ? withoutHash
          .split('')
          .map((char) => char + char)
          .join('')
      : withoutHash;
  return `#${expanded.toLowerCase()}`;
}

module.exports = {
  id: 'ha_set_light_color',
  signature: 'ha_set_light_color(entity_id, color_hex)',
  description: 'Set a configured Home Assistant color-capable light to a hex color.',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', minLength: 1 },
      color_hex: {
        type: 'string',
        pattern: '^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
        description: 'CSS-style RGB hex color such as #ff0000, #00ff88, or #f0a.',
      },
    },
    required: ['entity_id', 'color_hex'],
    additionalProperties: false,
  },
  availability(ctx = {}) {
    const mode = String(ctx.mode || '');
    if (mode === 'admin' || mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${mode}` };
    }
    if (ctx.homeAssistantState?.lightPolicy?.lockedOn) {
      return { available: false, reason: 'policy_lock:lights_locked_on' };
    }
    if (!ctx.homeAssistantState?.connected) return { available: false, reason: 'unavailable' };
    return { available: true, reason: null };
  },
  async execute({ args = {}, homeAssistantService }) {
    const resolved = resolveConfiguredEntity(
      homeAssistantService,
      args?.entity_id || args?.entityId,
      'ha_set_light_color',
    );
    const { entity, entityId } = resolved;

    // Accepting args.color as a compatibility alias keeps manual/internal calls
    // forgiving, while the public tool schema still teaches the model to send
    // the clearer color_hex argument.
    const colorHex = normalizeColorHex(args?.color_hex ?? args?.colorHex ?? args?.color);

    // setLightColor already requires a HA light, but checking the normalized
    // entity state here gives the overseer a more specific error and blocks
    // switch/outlet-backed lamps before they become invalid HA color commands.
    if (entity.type !== 'light') throw new Error('ha_set_light_color requires a light entity');
    if (entity.available === false) throw new Error('ha_set_light_color light entity unavailable');
    if (!entity.supportsColor) throw new Error('ha_set_light_color light does not report color support');

    await homeAssistantService.setLightColor(entityId, colorHex);
    return { ok: true, entity_id: entityId, color_hex: colorHex };
  },
};
