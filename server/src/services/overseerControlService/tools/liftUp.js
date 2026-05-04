module.exports = {
  signature: 'lift_up()',
  availability(ctx = {}) {
    const mode = String(ctx.mode || '');
    if (mode === 'admin' || mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${mode}` };
    }
    if (!ctx.liftState?.connected) return { available: false, reason: 'unavailable' };
    if (ctx.liftState?.busy) return { available: false, reason: 'busy' };
    return { available: true, reason: null };
  },
};
