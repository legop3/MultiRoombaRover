// Drive Dock State
// Purpose: Selects only dock-related telemetry fields needed by drive/dock controls.
// Scope: Keeps the action component focused on rendering while this hook owns telemetry subscription details.

import { useMemo } from 'react';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';
import { dockTelemetryEqual, selectDockTelemetry } from '../../context/telemetryViews.js';

export function deriveDriveDockStateFromTelemetry(dockTelemetry) {
  const oiLabel = dockTelemetry?.oiModeLabel || 'Unknown';
  const chargingLabel = dockTelemetry?.chargingStateLabel || '';
  const docked = Boolean(dockTelemetry?.homeBase);
  const charging = dockTelemetry?.dockingPhase === 'charging';
  const driving = dockTelemetry?.drivingMode === true && !dockTelemetry?.movementLocked;
  const dockedNotCharging = docked && !charging;
  const dockingInProgress = dockTelemetry?.autoDocking === true;
  return { driving, docked, charging, dockedNotCharging, dockingInProgress, oiLabel, chargingLabel };
}

export function useDriveDockState(roverId) {
  const dockTelemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  return useMemo(() => deriveDriveDockStateFromTelemetry(dockTelemetry), [dockTelemetry]);
}
