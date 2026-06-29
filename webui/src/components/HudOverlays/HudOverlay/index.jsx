// Hud Overlay
// Purpose: Defines the Hud Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { useHudMapSetting } from '../../../hooks/useHudMapSetting.js';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import {
  selectSpectatorTelemetry,
  spectatorTelemetryEqual,
} from '../../../context/telemetryViews.js';
import RoverLabelOverlay from './RoverLabelOverlay.jsx';
import SpectatorTelemetryOverlay from './SpectatorTelemetryOverlay.jsx';
import HudMapOverlay from './HudMapOverlay.jsx';

function HudOverlay({
  roverId = null,
  sensors,
  label,
  roverColor = null,
  layoutFormat = 'desktop',
  variant = 'default',
  driverLabel = null,
  showTopDown = undefined,
  mobileHud = false,
  mapPosition = null,
  labelScale = 1,
}) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const spectatorTelemetry = useVisualTelemetrySelector(effectiveRoverId, selectSpectatorTelemetry, spectatorTelemetryEqual);
  const rosterInfo = useSessionSelector((state) => {
    if (!effectiveRoverId) return { label: null, roverColor: null };
    const roster = state.session?.roster || [];
    const rover = roster.find((entry) => String(entry.id) === String(effectiveRoverId));
    return {
      label: rover?.name || null,
      roverColor: rover?.color || null,
    };
  });
  const derivedDriverLabel = useSessionSelector((state) => {
    if (!effectiveRoverId || variant !== 'spectator') return null;
    const activeId = state.session?.activeDrivers?.[effectiveRoverId] || null;
    const users = state.session?.users || [];
    const match = users.find((u) => String(u.socketId || '') === String(activeId || ''));
    return match?.nickname || match?.name || null;
  });
  const resolvedSensors = sensors ?? null;
  const resolvedLabel = label ?? rosterInfo.label ?? null;
  const resolvedRoverColor = roverColor ?? rosterInfo.roverColor ?? null;
  const resolvedDriverLabel = driverLabel ?? derivedDriverLabel;
  const isMobile = mobileHud;
  const [showHudMapDesktop] = useHudMapSetting();
  const resolvedShowTopDown =
    typeof showTopDown === 'boolean'
      ? showTopDown
      : variant === 'spectator'
      ? true
      : isMobile
      ? true
      : showHudMapDesktop;
  const resolvedMapPosition =
    mapPosition || (variant === 'spectator' ? 'top-center' : isMobile ? 'top-right' : 'top-center');

  if (variant === 'none') {
    return null;
  }

  if (variant === 'spectator') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <SpectatorTelemetryOverlay sensors={resolvedSensors} telemetry={sensors ? null : spectatorTelemetry} mobileHud={isMobile} />
          <RoverLabelOverlay
            variant="spectator"
            label={resolvedLabel}
            roverColor={resolvedRoverColor}
            driverLabel={resolvedDriverLabel}
            mobileHud={isMobile}
            labelScale={labelScale}
          />
        </div>
        <HudMapOverlay
          roverId={effectiveRoverId}
          sensors={resolvedSensors}
          show={resolvedShowTopDown}
          mapPosition={resolvedMapPosition}
          layoutFormat={layoutFormat}
          mobileHud={isMobile}
        />
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <RoverLabelOverlay
        variant="default"
        label={resolvedLabel}
        roverColor={resolvedRoverColor}
        mobileHud={isMobile}
        labelScale={labelScale}
      />
      <HudMapOverlay
        roverId={effectiveRoverId}
        sensors={resolvedSensors}
        show={resolvedShowTopDown && variant !== 'spectator'}
        mapPosition={resolvedMapPosition}
        layoutFormat={layoutFormat}
        mobileHud={isMobile}
      />
    </div>
  );
}

export default React.memo(HudOverlay);
