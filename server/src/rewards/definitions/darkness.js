const DURATION_MS = 60 * 1000;

let activeTimer = null;

async function stopDarkness(ctx, effect = {}) {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  const prevLights = Array.isArray(effect.prevLights) ? effect.prevLights : [];
  await Promise.all(
    prevLights.map(async (entry) => {
      try {
        await ctx.setHomeAssistantEntityState(entry.id, entry.state === 'on' ? 'on' : 'off');
      } catch (err) {
        ctx.logger.warn('darkness restore light failed', { entityId: entry.id, error: err.message });
      }
    }),
  );

  const prevNightVision = effect.prevNightVision && typeof effect.prevNightVision === 'object'
    ? effect.prevNightVision
    : {};
  Object.entries(prevNightVision).forEach(([roverId, wasOn]) => {
    try {
      ctx.issueCommand(String(roverId), {
        type: 'nightVision',
        nightVision: { action: wasOn ? 'on' : 'off' },
      });
    } catch (err) {
      ctx.logger.warn('darkness restore nightVision failed', { roverId, error: err.message });
    }
  });

  ctx.clearEffect('darkness');
}

function startDarkness(ctx, effect) {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  const endsAt = Number(effect.endsAt || Date.now() + DURATION_MS);
  const remaining = Math.max(0, endsAt - Date.now());
  ctx.saveEffect('darkness', effect);
  activeTimer = setTimeout(() => {
    stopDarkness(ctx, effect).catch((err) => {
      ctx.logger.warn('darkness stop failed', { error: err.message });
    });
  }, remaining);
}

module.exports = {
  id: 'darkness',
  name: 'Darkness',
  goal: 650,
  async run(ctx) {
    const entities = ctx.getHomeAssistantEntities();
    const prevLights = entities.map((entity) => ({ id: entity.id, state: entity.state === 'on' ? 'on' : 'off' }));
    await Promise.all(
      entities.map(async (entity) => {
        try {
          await ctx.setHomeAssistantEntityState(entity.id, 'off');
        } catch (err) {
          ctx.logger.warn('darkness light off failed', { entityId: entity.id, error: err.message });
        }
      }),
    );

    const prevNightVision = {};
    ctx.listOnlineRovers().forEach((rover) => {
      const state = rover?.nightVision?.state;
      const nightVisionOn = Boolean(state && state.nightVisionOn === true);
      prevNightVision[String(rover.id)] = nightVisionOn;
      try {
        ctx.issueCommand(String(rover.id), {
          type: 'nightVision',
          nightVision: { action: 'off' },
        });
      } catch (err) {
        ctx.logger.warn('darkness nightVision off failed', { roverId: rover.id, error: err.message });
      }
    });

    const effect = { endsAt: Date.now() + DURATION_MS, prevLights, prevNightVision };
    startDarkness(ctx, effect);
    ctx.sendAlert({ color: '#212121', title: 'Darkness', message: 'Darkness effect active for 60 seconds.' });
  },
  async recover(ctx, effect) {
    if (!effect || Number(effect.endsAt || 0) <= Date.now()) {
      await stopDarkness(ctx, effect || {});
      return;
    }
    startDarkness(ctx, effect);
  },
};
