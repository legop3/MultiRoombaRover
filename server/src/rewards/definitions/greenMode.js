// Reward Definition: Green Mode
// Purpose: Enables the server-wide green theme and room effect for twenty minutes.
// Scope: Owns button-box timing/recovery while delegating the actual mode to greenModeService.
const DURATION_MS = 20 * 60 * 1000;

let activeTimer = null;
let unsubscribeGreenMode = null;

function clearRuntimeWatchers() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (unsubscribeGreenMode) {
    unsubscribeGreenMode();
    unsubscribeGreenMode = null;
  }
}

async function stopGreenMode(ctx) {
  clearRuntimeWatchers();
  await ctx.setGreenMode(false, { source: 'buttonbox:greenModeExpired' });
  ctx.clearEffect('greenMode');
}

async function startGreenMode(ctx, effect = {}) {
  clearRuntimeWatchers();
  const endsAt = Number(effect.endsAt || Date.now() + DURATION_MS);
  const remaining = Math.max(0, endsAt - Date.now());

  if (remaining <= 0) {
    await stopGreenMode(ctx);
    return;
  }

  await ctx.setGreenMode(true, { source: 'buttonbox:greenMode' });
  ctx.saveEffect('greenMode', { endsAt });

  /*
    Access-mode changes disable green mode through greenModeService. Watching
    that shared state transition lets the reward discard its persisted effect
    immediately, so a restart cannot accidentally revive a reward that was
    intentionally ended early.
  */
  unsubscribeGreenMode = ctx.onGreenModeChange((enabled) => {
    if (enabled) return;
    clearRuntimeWatchers();
    ctx.clearEffect('greenMode');
  });

  activeTimer = setTimeout(() => {
    stopGreenMode(ctx).catch((err) => {
      ctx.logger.warn('green mode reward stop failed', { error: err.message });
    });
  }, remaining);
}

module.exports = {
  id: 'greenMode',
  name: 'Green mode',
  description: 'Makes the room and server green for 20 minutes.',
  goal: 5,
  async run(ctx) {
    await startGreenMode(ctx, { endsAt: Date.now() + DURATION_MS });
  },
  async recover(ctx, effect) {
    // Recovery must never manufacture a fresh twenty-minute window from a
    // missing or corrupt persisted deadline. Treat it as expired and clean up.
    if (!Number.isFinite(Number(effect?.endsAt))) {
      await stopGreenMode(ctx);
      return;
    }
    await startGreenMode(ctx, effect);
  },
};
