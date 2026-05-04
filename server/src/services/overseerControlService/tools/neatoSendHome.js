module.exports = {
  id: 'neato_send_home',
  signature: 'neato_send_home()',
  description: 'Send Neato back to base.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  availability(ctx = {}) {
    const mode = String(ctx.mode || '');
    if (mode === 'admin' || mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${mode}` };
    }
    if (!ctx.neatoState?.connected) return { available: false, reason: 'unavailable' };
    return { available: true, reason: null };
  },
  async execute({ neatoService }) {
    await neatoService.sendHome();
    return { ok: true };
  },
};
