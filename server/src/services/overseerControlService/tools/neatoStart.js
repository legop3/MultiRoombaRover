module.exports = {
  id: 'neato_start',
  signature: 'neato_start()',
  description: 'Start Neato cleaning cycle.',
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
    await neatoService.startCleaning();
    return { ok: true };
  },
};
