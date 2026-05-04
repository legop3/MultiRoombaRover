module.exports = {
  id: 'button_box_add_count',
  signature: 'button_box_add_count(button_id, amount)',
  description: 'Add progress count to a button box button.',
  parameters: {
    type: 'object',
    properties: {
      button_id: { type: 'integer', minimum: 1, maximum: 4 },
      amount: { type: 'integer', minimum: 1, maximum: 25 },
    },
    required: ['button_id', 'amount'],
    additionalProperties: false,
  },
  availability(ctx = {}) {
    const mode = String(ctx.mode || '');
    if (mode === 'admin' || mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${mode}` };
    }
    return { available: true, reason: null };
  },
  async execute({ args = {}, buttonBoxService }) {
    const buttonId = Math.max(1, Math.min(4, Number(args?.button_id) || 0));
    const amount = Math.max(1, Math.min(25, Number(args?.amount) || 0));
    if (!buttonId) throw new Error('button_box_add_count requires args.button_id 1..4');
    if (!amount) throw new Error('button_box_add_count requires args.amount 1..25');
    const resp = await buttonBoxService.addButtonBoxCount(buttonId, amount);
    return { ok: true, button: resp };
  },
};
