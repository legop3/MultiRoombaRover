import { useDriveControl } from '../context/DriveControlContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';

const manualOiButtons = [
  { key: 'safe', label: 'Safe' },
  { key: 'passive', label: 'Passive' },
  { key: 'full', label: 'Full' },
];

export default function DrivePanel() {
  const { roverId, speeds, stopMotors, sendOiCommand, runStartDockFull, seekDock } = useDriveControl();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const drivingMode = (sensors.oiMode?.label || '').toLowerCase() === 'full';
  const docked = Boolean(sensors.chargingSources?.homeBase);
  const charging = Boolean(
    sensors.chargingState?.label && sensors.chargingState.label.toLowerCase() !== 'not charging',
  );
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;

  return (
    <section className="rounded-lg border border-slate-900 bg-slate-950/70 p-2 text-[0.8rem] text-slate-100">
      <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">
        <span>Drive Control</span>
        <span>{roverId ? `Rover ${roverId}` : 'unassigned'}</span>
      </div>
      <div className="mt-2 space-y-2">
        <div>
          <button
            type="button"
            onClick={runStartDockFull}
            disabled={!roverId}
            className="w-full rounded border border-emerald-500/40 bg-emerald-500/10 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-emerald-200 disabled:opacity-40"
          >
            Enable Driving Mode
          </button>
          <p className="mt-1 text-[0.65rem] text-slate-400">Runs Start → Dock → Full commands to ready the rover.</p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.6rem]">
            <StatusPill label="Driving mode" active={drivingMode} />
            {updated && <span className="text-slate-500">Updated {updated}</span>}
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={seekDock}
            disabled={!roverId}
            className="w-full rounded border border-cyan-500/40 bg-cyan-500/10 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-cyan-200 disabled:opacity-40"
          >
            Seek Dock
          </button>
          <p className="mt-1 text-[0.65rem] text-slate-400">
            Point the rover straight at the dock, about one foot away, before triggering.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusPill label={docked ? 'Docked' : 'Not docked'} active={docked} />
            <StatusPill label={charging ? 'Charging' : 'Not charging'} active={charging} />
          </div>
        </div>
        <SpeedRow left={speeds.left} right={speeds.right} />
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-slate-500">Manual OI</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {manualOiButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => sendOiCommand(btn.key)}
                disabled={!roverId}
                className="rounded border border-slate-800 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.2em] text-slate-200 disabled:opacity-30"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={stopMotors}
            disabled={!roverId}
            className="flex-1 rounded border border-red-500/50 bg-red-500/10 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-red-200 disabled:opacity-40"
          >
            Stop Motors
          </button>
        </div>
      </div>
      <p className="mt-2 text-[0.6rem] text-slate-500">Sensor streaming auto-starts after each OI change.</p>
    </section>
  );
}

function SpeedRow({ left, right }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded border border-slate-900 bg-black/50 p-1 text-[0.7rem]">
      <div>
        <p className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-500">Left</p>
        <p className="font-semibold text-slate-100">{left}</p>
      </div>
      <div>
        <p className="text-[0.55rem] uppercase tracking-[0.3em] text-slate-500">Right</p>
        <p className="font-semibold text-slate-100">{right}</p>
      </div>
    </div>
  );
}

function StatusPill({ label, active }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] ${
        active
          ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
          : 'border-slate-700 bg-slate-900 text-slate-500'
      }`}
    >
      {label}
    </span>
  );
}
