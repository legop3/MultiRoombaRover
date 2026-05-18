import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';

export function useManualDockAssist(options = {}) {
  const { manageLifecycle = false } = options;
  const {
    state: { roverId, manualDockAssist },
    actions,
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const chargingLabel = sensors?.chargingState?.label || '';
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const charging = docked && chargingLabel.toLowerCase() !== 'not charging' && chargingLabel !== '';
  const active = Boolean(manualDockAssist?.active);
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
    if (active && justDocked) {
      actions.sendSong([{ note: 84, duration: 6 }], { slot: 1 });
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

