import { useState } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';

export default function DriveModeToggle({ size = 'default' }) {
  const {
    state: { roverId },
    actions,
  } = useControlSystem();
  const [pending, setPending] = useState(null);
  const disabled = !roverId || pending !== null;
  const frame = useTelemetryFrame(roverId);
  const oiLabel = frame?.sensors?.oiMode?.label || 'Unknown';
  const oiNormalized = oiLabel.toLowerCase();
  const driveReady = oiNormalized === 'full';
  const currentLabel = driveReady ? 'Drive Ready' : `OI Mode: ${oiLabel}`;

  const handleDrive = async () => {
    if (!roverId) return;
    setPending('drive');
    try {
      actions.setMode('drive');
      await actions.runMacro('drive-sequence');
    } finally {
      setPending(null);
    }
  };

  const handleDock = async () => {
    if (!roverId) return;
    setPending('dock');
    try {
      actions.setMode('dock');
      await actions.runMacro('seek-dock');
    } finally {
      setPending(null);
    }
  };

  const pillClass = size === 'compact' ? 'text-xs px-0.5 py-0.5' : 'text-sm px-0.5 py-0.5';

  return (
    <div className="bg-black/30 p-0.5 text-slate-100">
      <div className="flex items-center">
        <span className={`${driveReady ? 'bg-emerald-700' : 'bg-indigo-700'} ${pillClass}`}>
          {currentLabel}
        </span>
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-0.5 text-xs">
        <button
          type="button"
          onClick={handleDrive}
          disabled={disabled}
          className={`bg-emerald-600 px-0.5 py-0.5 font-semibold text-emerald-50 transition-colors hover:bg-emerald-500 disabled:opacity-40 ${size === 'compact' ? 'text-xs' : 'text-sm'}`}
        >
          Drive
        </button>
        <button
          type="button"
          onClick={handleDock}
          disabled={disabled}
          className={`bg-indigo-600 px-0.5 py-0.5 font-semibold text-indigo-50 transition-colors hover:bg-indigo-500 disabled:opacity-40 ${size === 'compact' ? 'text-xs' : 'text-sm'}`}
        >
          Dock
        </button>
      </div>
    </div>
  );
}
