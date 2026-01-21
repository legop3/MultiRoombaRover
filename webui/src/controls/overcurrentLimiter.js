import { useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

export const OVERCURRENT_MOTORS = ['leftWheel', 'rightWheel', 'mainBrush', 'sideBrush'];

export const DEFAULT_OVERCURRENT_LIMITS = {
  meterAChargeSec: 9,
  meterADecaySec: 9,
  meterBChargeSec: 5,
  meterBDecaySec: 5,
};

function createInitialMeters() {
  return OVERCURRENT_MOTORS.reduce((acc, key) => {
    acc[key] = { a: 0, b: 0 };
    return acc;
  }, {});
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stepValue(current, delta, seconds, direction) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return direction === 'up' ? 1 : 0;
  }
  const amount = delta / seconds;
  return direction === 'up' ? current + amount : current - amount;
}

export function useOvercurrentLimiter(roverId, options = {}) {
  const { session } = useSession();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const overcurrentFlags = sensors?.wheelOvercurrents || {};
  const config = useMemo(
    () => ({ ...DEFAULT_OVERCURRENT_LIMITS, ...(options.config || {}) }),
    [options.config],
  );
  const [meters, setMeters] = useState(() => createInitialMeters());
  const lastTickRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const flagsRef = useRef(overcurrentFlags);

  useEffect(() => {
    flagsRef.current = overcurrentFlags || {};
  }, [overcurrentFlags]);

  useEffect(() => {
    setMeters(createInitialMeters());
  }, [roverId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const deltaMs = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      const deltaSec = deltaMs / 1000;
      if (deltaSec <= 0) return;
      setMeters((prev) => {
        let changed = false;
        const next = {};
        OVERCURRENT_MOTORS.forEach((key) => {
          const prevEntry = prev[key] || { a: 0, b: 0 };
          const over = Boolean(flagsRef.current?.[key]);
          const nextA = clampUnit(
            stepValue(
              prevEntry.a,
              deltaSec,
              over ? config.meterAChargeSec : config.meterADecaySec,
              over ? 'up' : 'down',
            ),
          );
          const shouldFillB = over && nextA >= 1;
          const nextB = clampUnit(
            stepValue(
              prevEntry.b,
              deltaSec,
              shouldFillB ? config.meterBChargeSec : config.meterBDecaySec,
              shouldFillB ? 'up' : 'down',
            ),
          );
          if (Math.abs(nextA - prevEntry.a) > 0.0001 || Math.abs(nextB - prevEntry.b) > 0.0001) {
            changed = true;
          }
          next[key] = { a: nextA, b: nextB };
        });
        return changed ? next : prev;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [config.meterAChargeSec, config.meterADecaySec, config.meterBChargeSec, config.meterBDecaySec]);

  const scales = useMemo(() => {
    const perMotor = OVERCURRENT_MOTORS.reduce((acc, key) => {
      acc[key] = clampUnit(1 - (meters?.[key]?.b ?? 0));
      return acc;
    }, {});
    return {
      perMotor,
      drive: {
        left: perMotor.leftWheel ?? 1,
        right: perMotor.rightWheel ?? 1,
      },
      aux: {
        main: perMotor.mainBrush ?? 1,
        side: perMotor.sideBrush ?? 1,
        vacuum: 1,
      },
    };
  }, [meters]);

  const overcurrent = useMemo(
    () =>
      OVERCURRENT_MOTORS.reduce((acc, key) => {
        acc[key] = Boolean(overcurrentFlags?.[key]);
        return acc;
      }, {}),
    [overcurrentFlags],
  );

  const adminImmune =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';

  return useMemo(
    () => ({
      meters,
      overcurrent,
      scales,
      config,
      adminImmune,
    }),
    [meters, overcurrent, scales, config, adminImmune],
  );
}

export function applyDriveOvercurrentScale(speeds = {}, scales, adminImmune = false) {
  if (adminImmune || !scales?.drive) return speeds;
  const leftScale = typeof scales.drive.left === 'number' ? scales.drive.left : 1;
  const rightScale = typeof scales.drive.right === 'number' ? scales.drive.right : 1;
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
  return {
    main: Math.round((values.main ?? 0) * mainScale),
    side: Math.round((values.side ?? 0) * sideScale),
    vacuum: Math.round((values.vacuum ?? 0) * vacuumScale),
  };
}
