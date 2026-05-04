module.exports = {
  id: 'ha_set_entity',
  signature: 'ha_set_entity(entity_id, state)',
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
    const state = String(args?.state || '').toLowerCase();
    if (state !== 'on' && state !== 'off') throw new Error('ha_set_entity requires args.state of on/off');
    await homeAssistantService.setEntityState(entityId, state, { source: 'overseerControl' });
    return { ok: true };
  },
};
