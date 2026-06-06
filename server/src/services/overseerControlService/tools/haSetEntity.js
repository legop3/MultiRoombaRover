module.exports = {
  id: 'ha_set_entity',
  signature: 'ha_set_entity(entity_id, state)',
  description: 'Turn a configured room light or Home Assistant controllable entity on/off, including switch-backed lamps.',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', minLength: 1 },
      state: { type: 'string', enum: ['on', 'off'] },
    },
    required: ['entity_id', 'state'],
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
    const entityId = String(args?.entity_id || args?.entityId || '').trim();
    if (!entityId) throw new Error('ha_set_entity requires args.entity_id');

    // Configured Home Assistant entities are the room-control surface the
    // overseer is allowed to use. Some physical room lights are exposed by Home
    // Assistant as switches because they are outlet-backed lamps, so this tool
    // intentionally permits every configured entity for on/off control instead
    // of limiting itself to HA's light domain.
    const allowed = new Set(
      (homeAssistantService.getState()?.entities || []).map((entry) => String(entry?.id || '')).filter(Boolean),
    );
    if (!allowed.has(entityId)) throw new Error('ha_set_entity entity_id not configured');
    const state = String(args?.state || '').toLowerCase();
    if (state !== 'on' && state !== 'off') throw new Error('ha_set_entity requires args.state of on/off');
    await homeAssistantService.setEntityState(entityId, state, { source: 'overseerControl' });
    return { ok: true };
  },
};
