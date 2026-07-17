// Overcurrent Protection View Hook
// Purpose: Adapts server-authoritative protection telemetry for existing control and HUD consumers.
// Scope: Contains no protection timers or command scaling; enforcement belongs exclusively to the server service.

import { useMemo } from 'react';
import { useTelemetrySelector } from '../context/TelemetryContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';

export const OVERCURRENT_GROUPS = [
  { key: 'drive', motors: ['leftWheel', 'rightWheel'] },
  { key: 'aux', motors: ['mainBrush', 'sideBrush'] },
];

const EMPTY_PROTECTION = Object.freeze({
  status: 'idle',
  bypassed: false,
  drive: Object.freeze({ cap: 1, blocked: false, requiresNeutral: false, stopReason: null }),
  motors: Object.freeze({}),
  config: Object.freeze({}),
});

function selectOvercurrentProtection(frame) {
  return frame?.overcurrentProtection || EMPTY_PROTECTION;
}

export function useOvercurrentLimiter(roverId) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const protection = useTelemetrySelector(roverId, selectOvercurrentProtection);
  const adminImmune = role === 'admin' || role === 'lockdown';

  return useMemo(() => {
    const motors = protection?.motors || {};
    const driveCap = Number.isFinite(protection?.drive?.cap) ? protection.drive.cap : 1;
    const mainCap = Number.isFinite(motors?.mainBrush?.cap) ? motors.mainBrush.cap : 1;
    const sideCap = Number.isFinite(motors?.sideBrush?.cap) ? motors.sideBrush.cap : 1;
    const auxCap = Math.min(mainCap, sideCap);
    const motorFlags = OVERCURRENT_GROUPS.reduce((result, group) => {
      group.motors.forEach((motor) => {
        result[motor] = Boolean(motors?.[motor]?.overcurrent);
      });
      return result;
    }, {});
    const groupFlags = OVERCURRENT_GROUPS.reduce((result, group) => {
      result[group.key] = group.motors.some((motor) => motorFlags[motor]);
      return result;
    }, {});

    /*
      The compatibility-shaped fields keep existing control-context consumers
      simple while every value now comes from the same server snapshot. There
      is deliberately no local recovery loop: a stale or disconnected browser
      must never invent a safer state than the server actually calculated.
    */
    return {
      ...protection,
      caps: {
        drive: { cap: driveCap },
        aux: { cap: auxCap },
      },
      scales: {
        perGroup: { drive: driveCap, aux: auxCap },
        drive: { left: driveCap, right: driveCap },
        aux: { main: mainCap, side: sideCap, vacuum: 1 },
      },
      overcurrent: { motors: motorFlags, groups: groupFlags },
      isActive: protection?.status === 'limiting'
        || protection?.status === 'stopped'
        || protection?.status === 'recovering',
      adminImmune,
    };
  }, [adminImmune, protection]);
}
