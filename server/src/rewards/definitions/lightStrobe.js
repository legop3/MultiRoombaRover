const STROBE_MS = 10000;
const TICK_MS = 350;

let activeTimer = null;

async function applyAll(ctx, state) {
  const entities = ctx.getHomeAssistantEntities();
  await Promise.all(
    entities.map(async (entity) => {
      try {
        await ctx.setHomeAssistantEntityState(entity.id, state);
      } catch (err) {
        ctx.logger.warn('lightStrobe entity set failed', { entityId: entity.id, error: err.message });
      }
    }),
  );
}

function startStrobe(ctx, effect = {}) {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }

  const endsAt = Number(effect.endsAt || Date.now() + STROBE_MS);
  let on = Boolean(effect.on);
  ctx.saveEffect('lightStrobe', { endsAt, on });

  activeTimer = setInterval(async () => {
    if (Date.now() >= endsAt) {
      clearInterval(activeTimer);
      activeTimer = null;
      ctx.clearEffect('lightStrobe');
      return;
    }
    on = !on;
    await applyAll(ctx, on ? 'on' : 'off');
    ctx.saveEffect('lightStrobe', { endsAt, on });
  }, TICK_MS);
}

module.exports = {
  id: 'lightStrobe',
  name: 'Light Strobe',
  goal: 360,
  async run(ctx) {
    startStrobe(ctx, { endsAt: Date.now() + STROBE_MS, on: false });
    ctx.sendAlert({ color: '#ffc107', title: 'Light Strobe', message: 'Room light strobe started.' });
  },
  async recover(ctx, effect) {
    if (!effect || Number(effect.endsAt || 0) <= Date.now()) {
      ctx.clearEffect('lightStrobe');
      return;
    }
    startStrobe(ctx, effect);
  },
};
