// Operator Command Cooldowns
// Purpose: Rate limits individual commands per actor without coupling to a transport.
// Scope: In-memory only; a restart clears every cooldown by design.
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/*
  Fun commands are reachable from both site chat and Discord, and site chat's own
  rate limit only bounds messages per socket rather than a specific command. A
  per-actor, per-command gate is what stops one person turning `rs honk` into a
  siren, and it is deliberately in-memory: a cooldown that survives a restart
  would be a moderation feature, not a spam guard.
*/
function createCooldownGate({ sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
  const expiries = new Map();
  let lastSweep = 0;

  function sweep(now) {
    if (now - lastSweep < sweepIntervalMs) return;
    lastSweep = now;
    expiries.forEach((expiresAt, key) => {
      if (expiresAt <= now) expiries.delete(key);
    });
  }

  function remaining(key, now = Date.now()) {
    const expiresAt = expiries.get(String(key));
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - now);
  }

  /*
    Returns the remaining wait when the gate is closed, or 0 after arming the
    next window. Callers therefore treat any non-zero result as a refusal, and a
    refused call never extends the existing window.
  */
  function consume(key, windowMs, now = Date.now()) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return 0;
    const window = Number(windowMs);
    if (!Number.isFinite(window) || window <= 0) return 0;

    sweep(now);
    const wait = remaining(normalizedKey, now);
    if (wait > 0) return wait;
    expiries.set(normalizedKey, now + window);
    return 0;
  }

  function clear(key) {
    expiries.delete(String(key || '').trim());
  }

  function reset() {
    expiries.clear();
    lastSweep = 0;
  }

  return { consume, remaining, clear, reset };
}

function describeWait(waitMs) {
  const seconds = Math.ceil(Number(waitMs || 0) / 1000);
  if (seconds <= 1) return '1s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

module.exports = { createCooldownGate, describeWait };
