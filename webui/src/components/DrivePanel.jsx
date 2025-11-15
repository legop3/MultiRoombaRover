import { useDriveControls } from '../hooks/useDriveControls.js';

const oiButtons = [
  { key: 'start', label: 'Start OI' },
  { key: 'safe', label: 'Safe' },
  { key: 'full', label: 'Full' },
  { key: 'passive', label: 'Passive' },
  { key: 'dock', label: 'Dock' },
];

function SpeedMeter({ left, right }) {
  return (
    <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4 text-sm">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Left</p>
        <p className="text-2xl font-semibold text-white">{left}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Right</p>
        <p className="text-2xl font-semibold text-white">{right}</p>
      </div>
    </div>
  );
}

export default function DrivePanel() {
  const { roverId, speeds, stopMotors, sendOiCommand } = useDriveControls();

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Drive Controls</p>
          <h2 className="text-2xl font-semibold text-white">
            {roverId ? `Driving rover ${roverId}` : 'No rover assigned'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>W/A/S/D: move</span>
          <span>Shift: boost</span>
        </div>
      </header>

      <SpeedMeter left={speeds.left} right={speeds.right} />

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={stopMotors}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!roverId}
        >
          Stop Motors
        </button>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">OI Modes</p>
        <div className="flex flex-wrap gap-2">
          {oiButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={() => sendOiCommand(btn.key)}
              disabled={!roverId}
              className="rounded-lg border border-slate-700 px-3 py-1 text-sm font-semibold text-slate-200 disabled:opacity-50"
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Sensor streaming starts automatically after each OI change. Keep this tab focused while driving.
      </p>
    </section>
  );
}
