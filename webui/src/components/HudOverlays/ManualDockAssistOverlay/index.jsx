import { dockTelemetryEqual, selectDockTelemetry } from '../../../context/telemetryViews.js';
import { useTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import React, { useEffect, useRef, useState } from 'react';

function ManualDockAssistOverlay({ roverId, mobileHud = false }) {
  const telemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  const active = telemetry.cameraLocked;
  const charging = telemetry.dockingPhase === 'charging';
  const visible = active || telemetry.homeBase;
  const statusLabel = charging ? 'Docked and charging' : telemetry.homeBase ? 'Docked' : 'Docking assist active';
  const statusTone = charging ? 'good' : telemetry.homeBase ? 'warn' : 'active';
  const [popupMessage, setPopupMessage] = useState('');
  const timerRef = useRef(null);
  const [previousActive, setPreviousActive] = useState(active);

  // These messages are presentation only; telemetry owns the operation itself.
  if (previousActive !== active) {
    setPreviousActive(active);
    if (active) setPopupMessage('Dock assist mode enabled');
    else if (charging) setPopupMessage('Docking successful! Thank you!');
  }

  useEffect(() => {
    if (!popupMessage) return undefined;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setPopupMessage('');
      timerRef.current = null;
    }, 2500);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [popupMessage]);

  if (!visible) return null;
  const toneClass =
    statusTone === 'good'
      ? 'border-emerald-200/90 bg-emerald-900/90 text-emerald-50'
      : statusTone === 'warn'
      ? 'border-amber-200/90 bg-amber-900/90 text-amber-50'
      : 'border-cyan-200/90 bg-cyan-900/90 text-cyan-50';

  return (
    <div className="pointer-events-none absolute inset-0">
      {popupMessage ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`rounded-xl border border-indigo-200/95 bg-black/95 px-4 py-2 text-center font-semibold text-indigo-50 shadow-2xl ${
              mobileHud ? 'text-lg' : 'text-2xl'
            }`}
          >
            {popupMessage}
          </div>
        </div>
      ) : (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 font-semibold shadow-lg ${toneClass} ${
            mobileHud ? 'text-[0.65rem]' : 'text-xs'
          }`}
        >
          {statusLabel}
        </div>
      )}
    </div>
  );
}

export default React.memo(ManualDockAssistOverlay);
