import { useState } from 'react';
import { useControlSystem } from '../../controls/index.js';

export default function DriveModeToggle({ size = 'default' }) {
  const {
    state: { roverId, mode },
    actions,
  } = useControlSystem();
  const [pending, setPending] = useState(null);
  const disabled = !roverId || pending !== null;

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

  const pillClass =
    size === 'compact'
      ? 'text-xs px-1 py-0.5'
      : 'text-sm px-1.5 py-0.5';
  const currentLabel = mode === 'dock' ? 'Dock mode' : 'Drive mode';

  return (
    <div className="rounded-sm bg-black/30 p-1 text-slate-100">
      <div className="flex items-center justify-between">
        <span className={`rounded-full bg-slate-800 ${pillClass}`}>{currentLabel}</span>
        <span className="text-[0.65rem] text-slate-400">Rover {roverId ?? '—'}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <button
          type="button"
          onClick={handleDrive}
          disabled={disabled}
          className={`rounded-sm bg-emerald-600 px-1 py-1 font-semibold uppercase tracking-wide text-emerald-50 disabled:opacity-40 ${size === 'compact' ? 'text-xs' : 'text-sm'}`}
        >
          Drive
        </button>
        <button
          type="button"
          onClick={handleDock}
          disabled={disabled}
          className={`rounded-sm bg-indigo-600 px-1 py-1 font-semibold uppercase tracking-wide text-indigo-50 disabled:opacity-40 ${size === 'compact' ? 'text-xs' : 'text-sm'}`}
        >
          Dock
        </button>
      </div>
    </div>
  );
}
