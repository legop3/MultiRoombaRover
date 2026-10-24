const activityControls = require('../../homeAssistantActivitiesService');
const { getMode } = require('../../modeManager');

module.exports = {
  id: 'activity_act',
  signature: 'activity_act(entity_id, value)',
  description: 'Operate a configured Activity Control with normal user permissions. Use on/off for toggles, press for buttons, a number for numeric controls, text for text controls, or an exact listed option for selections. Locked and read-only items cannot be changed.',
  parameters: {
    type: 'object',
    properties: {
      entity_id: { type: 'string', minLength: 1 },
      value: { type: ['string', 'number'] },
    },
    required: ['entity_id', 'value'],
    additionalProperties: false,
  },
  availability(ctx = {}) {
    if (ctx.mode === 'admin' || ctx.mode === 'lockdown') {
      return { available: false, reason: `policy_lock:site_mode_${ctx.mode}` };
    }
    if (!ctx.activityState?.enabled || !ctx.activityState?.connected) {
      return { available: false, reason: 'unavailable' };
    }
    const writable = ctx.activityState.items?.some((item) => item.available && !item.locked && !item.readOnly && item.type !== 'readOnly');
    return { available: Boolean(writable), reason: writable ? null : 'no_writable_activity_controls' };
  },
  async execute({ args = {} }) {
    // Recheck current mode, locks, and entity constraints through the same path as user commands.
    await activityControls.act(args.entity_id, args.value, { role: 'user', mode: getMode() });
    return { ok: true };
  },
};
