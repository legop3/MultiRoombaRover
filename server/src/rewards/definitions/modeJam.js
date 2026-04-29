// Reward Definition: Mode Jam
// Purpose: Defines the mode-jam reward that interferes with mode/state transitions. Scope: Supplies effect metadata and execution inputs to reward orchestration code.
const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 10 * 60 * 1000;

let activeTimer = null;

function clearTimer() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

async function restore(ctx, effect = {}) {
  clearTimer();
  const prevMode = effect.prevMode;
  const prevReason = effect.prevReason;

  if (prevMode) {
    try {
      ctx.setMode(prevMode, 'buttonbox:modeJamRestore');
    } catch (err) {
      ctx.logger.warn('modeJam restore mode failed', { error: err.message });
    }
  }
  try {
    if (prevReason == null || prevReason === '') {
      ctx.clearAdminReason('buttonbox:modeJamRestore');
    } else {
      ctx.setAdminReason(prevReason, 'buttonbox:modeJamRestore');
    }
  } catch (err) {
    ctx.logger.warn('modeJam restore reason failed', { error: err.message });
  }

  ctx.clearEffect('modeJam');
}

function scheduleRestore(ctx, effect = {}) {
  clearTimer();
  const endsAt = Number(effect.endsAt || Date.now() + MIN_DURATION_MS);
  const remaining = Math.max(0, endsAt - Date.now());
  const next = { ...effect, endsAt };
  ctx.saveEffect('modeJam', next);
  activeTimer = setTimeout(() => {
    restore(ctx, next).catch((err) => {
      ctx.logger.warn('modeJam restore failed', { error: err.message });
    });
  }, remaining);
}

module.exports = {
  id: 'modeJam',
  name: 'Admin Lock',
  goal: 900,
  async run(ctx) {
    const durationMs =
      MIN_DURATION_MS + Math.floor(Math.random() * (MAX_DURATION_MS - MIN_DURATION_MS + 1));
    const endsAt = Date.now() + durationMs;
    const prevMode = ctx.getMode();
    const prevReason = ctx.getAdminReasonText();
    const jamReason = `Locked by button box until ${new Date(endsAt).toLocaleTimeString()}`;

    try {
      ctx.setMode('admin', 'buttonbox:modeJam');
    } catch (err) {
      ctx.logger.warn('modeJam set mode failed', { error: err.message });
    }
    try {
      ctx.setAdminReason(jamReason, 'buttonbox:modeJam');
    } catch (err) {
      ctx.logger.warn('modeJam set reason failed', { error: err.message });
    }

    scheduleRestore(ctx, {
      prevMode,
      prevReason,
      endsAt,
    });

    ctx.sendAlert({ color: '#ff5722', title: 'Admin Mode', message: 'Server forced into admin mode temporarily.' });
  },
  async recover(ctx, effect) {
    if (!effect || Number(effect.endsAt || 0) <= Date.now()) {
      await restore(ctx, effect || {});
      return;
    }
    scheduleRestore(ctx, effect);
  },
};
