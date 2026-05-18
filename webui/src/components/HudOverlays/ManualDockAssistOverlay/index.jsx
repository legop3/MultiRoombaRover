import React from 'react';
import { useManualDockAssist } from '../../../features/manualDockAssist/useManualDockAssist.js';

function ManualDockAssistOverlay({ mobileHud = false }) {
  const { visible, statusLabel, statusTone } = useManualDockAssist({ manageLifecycle: true });
  if (!visible) return null;
  const toneClass =
    statusTone === 'good'
      ? 'border-emerald-200/70 bg-emerald-900/85 text-emerald-50'
      : statusTone === 'warn'
      ? 'border-amber-200/70 bg-amber-900/85 text-amber-50'
      : 'border-indigo-200/70 bg-indigo-900/85 text-indigo-50';

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 font-semibold shadow-lg ${toneClass} ${
          mobileHud ? 'text-[0.65rem]' : 'text-xs'
        }`}
      >
        {statusLabel}
      </div>
    </div>
  );
}

export default React.memo(ManualDockAssistOverlay);
