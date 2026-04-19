const DURATION_MS = 5 * 60 * 1000;
const LIGHT_ENFORCE_TICK_MS = 3000;

let activeTimer = null;
let enforceLightsTimer = null;
let nightVisionLockUntil = 0;

function isNightVisionBlocked() {
  return Date.now() < nightVisionLockUntil;
}

function clearTimers() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (enforceLightsTimer) {
    clearInterval(enforceLightsTimer);
    enforceLightsTimer = null;
  }
}

async function forceAllLightsOff(ctx) {
  const entities = ctx.getHomeAssistantEntities();
  await Promise.all(
    entities.map(async (entity) => {
      try {
        await ctx.setHomeAssistantEntityState(entity.id, 'off');
      } catch (err) {
        ctx.logger.warn('darkness force light off failed', { entityId: entity.id, error: err.message });
      }
    }),
  );
}

async function stopDarkness(ctx, effect = {}) {
  clearTimers();
  nightVisionLockUntil = 0;

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

  try {
    const prevLockState = effect?.prevLightLockState;
    if (prevLockState === 'on' || prevLockState === 'off') {
      await ctx.setHomeAssistantLightsLockedOn(true, {
        source: 'buttonbox:darknessRestore',
        forceApply: true,
        targetState: prevLockState,
      });
    } else {
      await ctx.setHomeAssistantLightsLockedOn(false, {
        source: 'buttonbox:darknessRestore',
      });
    }
  } catch (err) {
    ctx.logger.warn('darkness restore light lock failed', { error: err.message });
  }

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

async function startDarkness(ctx, effect) {
  clearTimers();
  const endsAt = Number(effect.endsAt || Date.now() + DURATION_MS);
  const remaining = Math.max(0, endsAt - Date.now());
  nightVisionLockUntil = endsAt;
  try {
    await ctx.setHomeAssistantLightsLockedOn(true, {
      source: 'buttonbox:darkness',
      forceApply: true,
      targetState: 'off',
    });
  } catch (err) {
    ctx.logger.warn('darkness set light lock failed', { error: err.message });
  }
  ctx.saveEffect('darkness', effect);

  enforceLightsTimer = setInterval(() => {
    forceAllLightsOff(ctx).catch((err) => {
      ctx.logger.warn('darkness periodic light enforcement failed', { error: err.message });
    });
  }, LIGHT_ENFORCE_TICK_MS);

  activeTimer = setTimeout(() => {
    stopDarkness(ctx, effect).catch((err) => {
      ctx.logger.warn('darkness stop failed', { error: err.message });
    });
  }, remaining);
}

module.exports = {
  id: 'darkness',
  name: 'Darkness',
  isNightVisionBlocked,
  goal: 600,
  async run(ctx) {
    const entities = ctx.getHomeAssistantEntities();
    const prevLights = entities.map((entity) => ({ id: entity.id, state: entity.state === 'on' ? 'on' : 'off' }));
    await forceAllLightsOff(ctx);

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

    const prevPolicy = ctx.getHomeAssistantLightPolicy?.() || null;
    const prevLightLockState = prevPolicy?.lockState || (prevPolicy?.lockedOn ? 'on' : null);
    const effect = { endsAt: Date.now() + DURATION_MS, prevLights, prevNightVision, prevLightLockState };
    await startDarkness(ctx, effect);
    ctx.sendAlert({ color: '#212121', title: 'Darkness', message: 'Darkness effect active for 120 seconds.' });
  },
  async recover(ctx, effect) {
    if (!effect || Number(effect.endsAt || 0) <= Date.now()) {
      await stopDarkness(ctx, effect || {});
      return;
    }
    await startDarkness(ctx, effect);
  },
};
