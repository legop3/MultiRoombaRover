module.exports = {
  id: 'lift_down',
  signature: 'lift_down()',
  availability(ctx = {}) {
    const mode = String(ctx.mode || '');
    if (mode === 'admin' || mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${mode}` };
    }
    if (!ctx.liftState?.connected) return { available: false, reason: 'unavailable' };
    if (ctx.liftState?.busy) return { available: false, reason: 'busy' };
    return { available: true, reason: null };
  },
  async execute({ liftService, actor = 'overseerControl' }) {
    const resp = await liftService.moveDown(actor);
    return { ok: true, resp };
  },
};
