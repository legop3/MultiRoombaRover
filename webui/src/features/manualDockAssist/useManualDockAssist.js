import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';
import { dockTelemetryEqual, selectDockTelemetry } from '../../context/telemetryViews.js';

export function useManualDockAssist(options = {}) {
  const { manageLifecycle = false } = options;
  const roverId = useControlSelector((control) => control.state.roverId);
  const active = useControlSelector((control) => Boolean(control.state.manualDockAssist?.active));
  const actions = useControlActions();
  const dockTelemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  const chargingLabel = dockTelemetry.chargingStateLabel || '';
  const docked = Boolean(dockTelemetry.homeBase);
  const charging = docked && chargingLabel.toLowerCase() !== 'not charging' && chargingLabel !== '';
  const wasDockedRef = useRef(false);

  const enterAssist = useCallback(() => {
    actions.setManualDockAssistActive(true);
  }, [actions]);

  const exitAssist = useCallback(() => {
    actions.setManualDockAssistActive(false);
  }, [actions]);

  const toggleAssist = useCallback(() => {
    actions.toggleManualDockAssist();
  }, [actions]);

  useEffect(() => {
    if (!manageLifecycle) return;
    const justDocked = docked && !wasDockedRef.current;
    const justUndocked = !docked && wasDockedRef.current;
    if (active && justDocked) {
      // Stop on the first home-base contact so continued input cannot push the rover against the dock.
      actions.stopAllMotion();
      actions.sendSong([{ note: 84, duration: 6 }], { slot: 1 });
    } else if (active && justUndocked) {
      actions.sendSong([{ note: 72, duration: 6 }], { slot: 1 });
    }
    wasDockedRef.current = docked;
  }, [actions, active, docked, manageLifecycle]);

  useEffect(() => {
    if (!manageLifecycle || !active || !charging) return;
    exitAssist();
  }, [active, charging, exitAssist, manageLifecycle]);

  const statusLabel = charging ? 'Docked and charging' : docked ? 'Docked' : 'Docking assist active';
  const statusTone = charging ? 'good' : docked ? 'warn' : 'active';
  const visible = active || docked;

  return useMemo(
    () => ({
      active,
      docked,
      charging,
      cameraLocked: active,
      visible,
      statusLabel,
      statusTone,
      enterAssist,
      exitAssist,
      toggleAssist,
    }),
    [active, charging, docked, enterAssist, exitAssist, statusLabel, statusTone, toggleAssist, visible],
  );
}
