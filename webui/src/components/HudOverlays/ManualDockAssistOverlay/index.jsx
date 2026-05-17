import React from 'react';
import { useControlSystem } from '../../../controls/index.js';

function ManualDockAssistOverlay({ mobileHud = false }) {
  const {
    state: { manualDockAssist },
  } = useControlSystem();
  const active = Boolean(manualDockAssist?.active);
  if (!active) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className={`absolute left-2 rounded-lg border border-amber-200/70 bg-amber-900/85 px-2 py-1 font-semibold tracking-wide text-amber-50 shadow-lg ${
          mobileHud ? 'top-2 text-[0.65rem]' : 'top-2 text-xs'
        }`}
      >
        DOCKING ASSIST ACTIVE
      </div>
    </div>
  );
}

export default React.memo(ManualDockAssistOverlay);
