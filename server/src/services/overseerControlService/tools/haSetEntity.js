module.exports = {
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
};
