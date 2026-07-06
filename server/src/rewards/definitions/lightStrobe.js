// Reward Definition: Light Strobe
// Purpose: Defines the light-strobe deterrence reward and activation contract. Scope: Encapsulates reward identity, labels, and effect parameters for runtime dispatch.
const STROBE_MS = 60 * 1000;
const TICK_MS = 1500;

let activeTimer = null;

function applyAll(ctx, state) {
  const entities = ctx.getHomeAssistantEntities();
  entities.forEach((entity) => {
    ctx.setHomeAssistantEntityState(entity.id, state).catch((err) => {
      ctx.logger.warn('lightStrobe entity set failed', { entityId: entity.id, error: err.message });
    });
  });
}

function startStrobe(ctx, effect = {}) {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }

  const endsAt = Number(effect.endsAt || Date.now() + STROBE_MS);
  let on = Boolean(effect.on);
  ctx.saveEffect('lightStrobe', { endsAt, on });

  activeTimer = setInterval(() => {
    if (Date.now() >= endsAt) {
      clearInterval(activeTimer);
      activeTimer = null;
      ctx.clearEffect('lightStrobe');
      return;
    }
    on = !on;
    applyAll(ctx, on ? 'on' : 'off');
    ctx.saveEffect('lightStrobe', { endsAt, on });
  }, TICK_MS);
}

module.exports = {
  id: 'lightStrobe',
  name: 'Light Strobe',
  description: 'Makes the room lights flash rapidly for 30 seconds.',
  goal: 400,
  async run(ctx) {
    startStrobe(ctx, { endsAt: Date.now() + STROBE_MS, on: false });
    ctx.sendAlert({ color: '#ffc107', title: 'Light Strobe', message: 'All room controls strobing for 60 seconds.' });
  },
  async recover(ctx, effect) {
    if (!effect || Number(effect.endsAt || 0) <= Date.now()) {
      ctx.clearEffect('lightStrobe');
      return;
    }
    startStrobe(ctx, effect);
  },
};
