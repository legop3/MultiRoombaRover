import { useEffect, useMemo, useState } from 'react';

const HOLD_MS = 650;

const DOCK_CODES = {
  161: { red: true }, // Red buoy
  164: { green: true }, // Green buoy
  165: { force: true }, // Force field only
  168: { red: true, green: true }, // Red + green
  169: { red: true, force: true }, // Red + force
  172: { green: true, force: true }, // Green + force
  173: { red: true, green: true, force: true }, // Red + green + force
};

function decodeDockBits(code) {
  if (typeof code !== 'number' || code <= 0) return null;
  const bits = DOCK_CODES[code];
  if (!bits) return null;
  return { code, ...bits };
}

/**
 * Returns a smoothed view of dock IR signals. Keeps the last seen code alive for HOLD_MS to mask blinks.
 */
export function useDockIr(sensors, options = {}) {
  const holdMs = options.holdMs || HOLD_MS;
  const [state, setState] = useState({
    left: null,
    right: null,
    omni: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), Math.max(holdMs / 2, 100));
    return () => clearInterval(id);
  }, [holdMs]);

  useEffect(() => {
    const now = Date.now();
    const left = decodeDockBits(sensors?.infraredCharacterLeft);
    const right = decodeDockBits(sensors?.infraredCharacterRight);
    const omni = decodeDockBits(sensors?.infraredCharacterOmni);
    if (!left && !right && !omni) {
      return;
    }
    setState((prev) => ({
      left: left ? { ...left, ts: now } : prev.left,
      right: right ? { ...right, ts: now } : prev.right,
      omni: omni ? { ...omni, ts: now } : prev.omni,
    }));
  }, [sensors?.infraredCharacterLeft, sensors?.infraredCharacterRight, sensors?.infraredCharacterOmni]);

  useEffect(() => {
    // Debug: log when new codes appear
    const { left, right, omni } = state;
    const haveAny = left?.ts || right?.ts || omni?.ts;
    if (!haveAny) return;
    const stamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.debug('[DockIR]', stamp, {
      left: left?.code ?? 0,
      omni: omni?.code ?? 0,
      right: right?.code ?? 0,
    });
  }, [state.left?.code, state.right?.code, state.omni?.code]);

  return useMemo(() => {
    const now = Date.now();
    const withWindow = (entry) => {
      if (!entry) return { active: false, red: false, green: false, force: false, age: null, code: null };
      const age = now - entry.ts;
      const active = age <= holdMs;
      return {
        active,
        age,
        code: entry.code,
        red: Boolean(entry.red && active),
        green: Boolean(entry.green && active),
        force: Boolean(entry.force && active),
      };
    };

    const left = withWindow(state.left);
    const right = withWindow(state.right);
    const omni = withWindow(state.omni);
    const forceDetected = left.force || right.force || omni.force;
    const leftColor = left.red || left.green;
    const rightColor = right.red || right.green;
    const omniColor = omni.red || omni.green;
    // Show when close (force field), or both sides see buoys, or a side + omni see buoy(s) (to surface sooner without single-stray triggers).
    const visible = forceDetected || (leftColor && rightColor) || ((leftColor || rightColor) && omniColor);
    const bias =
      left.active && !right.active
        ? 'right'
        : right.active && !left.active
        ? 'left'
        : 'center';
    const balance = (right.active ? 1 : 0) - (left.active ? 1 : 0); // positive means steer left-to-right

    return {
      visible,
      forceDetected,
      left,
      right,
      omni,
      bias, // left/right/center for steering cue
      balance: Math.max(-1, Math.min(1, balance)),
    };
  }, [state.left, state.right, state.omni, holdMs, tick]);
}
