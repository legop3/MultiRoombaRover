// Light Bump Bars
// Purpose: Defines the Light Bump Bars module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';
import { lightBumpTelemetryEqual, selectLightBumpTelemetry } from '../../../context/telemetryViews.js';

function LightBumpBars({ roverId = null, sensors }) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const selectedValues = useVisualTelemetrySelector(effectiveRoverId, selectLightBumpTelemetry, lightBumpTelemetryEqual);
  const values = sensors
    ? [
        sensors?.lightBumpLeftSignal,
        sensors?.lightBumpFrontLeftSignal,
        sensors?.lightBumpCenterLeftSignal,
        sensors?.lightBumpCenterRightSignal,
        sensors?.lightBumpFrontRightSignal,
        sensors?.lightBumpRightSignal,
      ]
    : selectedValues;
  const max = values.filter((v) => v != null).reduce((acc, v) => Math.max(acc, v), 1200);
  const eased = (v) => Math.pow(Math.max(0, Math.min(1, (v ?? 0) / max)), 0.35);
  const hueFor = (v) => {
    if (v == null || v <= 0) return 'hsl(200 60% 18%)';
    const h = (200 + eased(v) * 360) % 360;
    return `hsl(${h} 100% 60%)`;
  };
  const segments = 6;
  const barHeight = 12;

  return (
    <div className="flex w-full items-center justify-center gap-0.5">
      {values.map((v, idx) => {
        const t = eased(v);
        const dir = idx < segments / 2 ? -1 : 1;
        const fill = `${t * 100}%`;
        const color = hueFor(v);
        return (
          <div key={idx} className="relative flex-1 min-w-[0]" style={{ height: `${barHeight}px` }}>
            <div className="h-full w-full overflow-hidden bg-slate-800" style={{ borderRadius: 0 }}>
              <div
                className="h-full"
                style={{
                  width: fill,
                  background: color,
                  float: dir === -1 ? 'right' : 'left',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(LightBumpBars);
