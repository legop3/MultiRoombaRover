import React from 'react';
import { useControlSystem } from '../../../controls/index.js';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useTelemetryFrame } from '../../../context/TelemetryContext.jsx';

function ManualDockAssistOverlay({ mobileHud = false }) {
  const {
    state: { manualDockAssist },
  } = useControlSystem();
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const chargingLabel = sensors?.chargingState?.label || '';
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const charging = docked && chargingLabel.toLowerCase() !== 'not charging' && chargingLabel !== '';
  const active = Boolean(manualDockAssist?.active);
  if (!active && !docked) return null;

  const status = charging
    ? 'Docked and charging'
    : docked
    ? 'Docked'
    : 'Docking assist active';
  const toneClass = charging
    ? 'border-emerald-200/70 bg-emerald-900/85 text-emerald-50'
    : docked
    ? 'border-amber-200/70 bg-amber-900/85 text-amber-50'
    : 'border-indigo-200/70 bg-indigo-900/85 text-indigo-50';

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 font-semibold shadow-lg ${toneClass} ${
          mobileHud ? 'text-[0.65rem]' : 'text-xs'
        }`}
      >
        {status}
      </div>
    </div>
  );
}

export default React.memo(ManualDockAssistOverlay);
