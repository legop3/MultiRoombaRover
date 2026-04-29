// Overcurrent Limiter Hook/Utility
// Purpose: Applies client-side overcurrent guard logic to reduce harmful command spikes. Scope: Tracks limiter state and exposes gated dispatch behavior to controls.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';

export const OVERCURRENT_GROUPS = [
  { key: 'drive', motors: ['leftWheel', 'rightWheel'] },
  { key: 'aux', motors: ['mainBrush', 'sideBrush'] },
];

export const DEFAULT_OVERCURRENT_LIMITS = {
  downRatePerSec: 0.15,
  upRatePerSec: 0.7,
  releaseDelaySec: 1,
  outputRateMs: 250,
};

function createInitialCaps() {
  return OVERCURRENT_GROUPS.reduce((acc, group) => {
    acc[group.key] = { cap: 1, clearSec: 0 };
    return acc;
  }, {});
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function useOvercurrentLimiter(roverId, options = {}) {
  const session = useSessionSelector((state) => state.session);
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const overcurrentFlags = sensors?.wheelOvercurrents || {};
  const config = useMemo(
    () => ({ ...DEFAULT_OVERCURRENT_LIMITS, ...(options.config || {}) }),
    [options.config],
  );
  const [caps, setCaps] = useState(() => createInitialCaps());
  const lastTickRef = useRef(0);
  const flagsRef = useRef(overcurrentFlags);

  useEffect(() => {
    flagsRef.current = overcurrentFlags || {};
  }, [overcurrentFlags]);

  useEffect(() => {
    setCaps(createInitialCaps());
    lastTickRef.current = 0;
  }, [roverId]);

  const hasAnyOvercurrent = useMemo(
    () => OVERCURRENT_GROUPS.some((group) => group.motors.some((motor) => Boolean(overcurrentFlags?.[motor]))),
    [overcurrentFlags],
  );
  const needsRecoveryTick = useMemo(
    () => Object.values(caps || {}).some((entry) => (Number.isFinite(entry?.cap) ? entry.cap : 1) < 0.999),
    [caps],
  );
  const shouldTick = Boolean(roverId) && (hasAnyOvercurrent || needsRecoveryTick);

  useEffect(() => {
    if (!shouldTick) return undefined;
    lastTickRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const interval = setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const deltaMs = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      const deltaSec = Math.min(0.25, deltaMs / 1000);
      if (deltaSec <= 0) return;
      setCaps((prev) => {
        let changed = false;
        const next = {};
        const downRate = Number.isFinite(config.downRatePerSec) ? Math.max(0, config.downRatePerSec) : 0;
        const upRate = Number.isFinite(config.upRatePerSec) ? Math.max(0, config.upRatePerSec) : 0;
        const releaseDelay = Number.isFinite(config.releaseDelaySec) ? Math.max(0, config.releaseDelaySec) : 0;
        OVERCURRENT_GROUPS.forEach((group) => {
          const prevEntry = prev[group.key] || { cap: 1, clearSec: 0 };
          const prevCap = Number.isFinite(prevEntry.cap) ? prevEntry.cap : 1;
          const prevClear = Number.isFinite(prevEntry.clearSec) ? prevEntry.clearSec : 0;
          const over = group.motors.some((motor) => Boolean(flagsRef.current?.[motor]));
          const nextClear = over ? 0 : prevClear + deltaSec;
          const allowRecover = !over && nextClear >= releaseDelay;
          const nextCap = clampUnit(
            over ? prevCap - downRate * deltaSec : allowRecover ? prevCap + upRate * deltaSec : prevCap,
          );
          if (Math.abs(nextCap - prevCap) > 0.0001 || Math.abs(nextClear - prevClear) > 0.0001) {
            changed = true;
          }
          next[group.key] = { cap: nextCap, clearSec: nextClear };
        });
        return changed ? next : prev;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [config.downRatePerSec, config.releaseDelaySec, config.upRatePerSec, roverId, shouldTick]);

  const scales = useMemo(() => {
    const perGroup = OVERCURRENT_GROUPS.reduce((acc, group) => {
      const entry = caps?.[group.key];
      const cap = Number.isFinite(entry?.cap) ? entry.cap : 1;
      acc[group.key] = clampUnit(cap);
      return acc;
    }, {});
    return {
      perGroup,
      drive: {
        left: perGroup.drive ?? 1,
        right: perGroup.drive ?? 1,
      },
      aux: {
        main: perGroup.aux ?? 1,
        side: perGroup.aux ?? 1,
        vacuum: 1,
      },
    };
  }, [caps]);

  const overcurrent = useMemo(() => {
    const motors = {};
    OVERCURRENT_GROUPS.forEach((group) => {
      group.motors.forEach((motor) => {
        motors[motor] = Boolean(overcurrentFlags?.[motor]);
      });
    });
    const groups = OVERCURRENT_GROUPS.reduce((acc, group) => {
      acc[group.key] = group.motors.some((motor) => Boolean(overcurrentFlags?.[motor]));
      return acc;
    }, {});
    return { motors, groups };
  }, [overcurrentFlags]);

  const adminImmune =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';

  return useMemo(
    () => ({
      caps,
      overcurrent,
      scales,
      isActive: (scales?.drive?.left ?? 1) < 1 || (scales?.drive?.right ?? 1) < 1 || (scales?.aux?.main ?? 1) < 1 || (scales?.aux?.side ?? 1) < 1,
      config,
      adminImmune,
    }),
    [caps, overcurrent, scales, config, adminImmune],
  );
}

export function applyDriveOvercurrentScale(speeds = {}, scales, adminImmune = false) {
  if (adminImmune || !scales?.drive) return speeds;
  const leftScale = typeof scales.drive.left === 'number' ? scales.drive.left : 1;
  const rightScale = typeof scales.drive.right === 'number' ? scales.drive.right : 1;
  if (leftScale >= 0.999 && rightScale >= 0.999) return speeds;
  return {
    left: Math.round((speeds.left ?? 0) * leftScale),
    right: Math.round((speeds.right ?? 0) * rightScale),
  };
}

export function applyAuxOvercurrentScale(values = {}, scales, adminImmune = false) {
  if (adminImmune || !scales?.aux) return values;
  const mainScale = typeof scales.aux.main === 'number' ? scales.aux.main : 1;
  const sideScale = typeof scales.aux.side === 'number' ? scales.aux.side : 1;
  const vacuumScale = typeof scales.aux.vacuum === 'number' ? scales.aux.vacuum : 1;
  if (mainScale >= 0.999 && sideScale >= 0.999 && vacuumScale >= 0.999) return values;
  return {
    main: Math.round((values.main ?? 0) * mainScale),
    side: Math.round((values.side ?? 0) * sideScale),
    vacuum: Math.round((values.vacuum ?? 0) * vacuumScale),
  };
}
