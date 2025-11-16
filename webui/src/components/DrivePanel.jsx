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
    <section className="rounded-sm bg-[#1b1b1b] p-1 text-sm text-slate-100">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Drive control</span>
        <span>{roverId ? `Rover ${roverId}` : 'unassigned'}</span>
      </div>
      <div className="mt-1 space-y-1">
        <div>
          <button
            type="button"
            onClick={runStartDockFull}
            disabled={!roverId}
            className="w-full rounded-sm bg-black/50 px-1 py-1 text-xs text-slate-200 disabled:opacity-30"
          >
            Enable driving mode
          </button>
          <p className="mt-1 text-xs text-slate-400">Runs Start → Dock → Full to prep sensors.</p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.65rem]">
            <StatusPill label="Driving" active={drivingMode} />
            {updated && <span className="text-slate-500">Sensors {updated}</span>}
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={seekDock}
            disabled={!roverId}
            className="w-full rounded-sm bg-black/50 px-1 py-1 text-xs text-slate-200 disabled:opacity-30"
          >
            Seek dock
          </button>
          <p className="mt-1 text-xs text-slate-400">Point the rover straight at the dock, about one foot away.</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusPill label={docked ? 'Docked' : 'Not docked'} active={docked} />
            <StatusPill label={charging ? 'Charging' : 'Not charging'} active={charging} />
          </div>
        </div>
        <SpeedRow left={speeds.left} right={speeds.right} />
        <div>
          <p className="text-xs text-slate-400">Manual OI</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {manualOiButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => sendOiCommand(btn.key)}
                disabled={!roverId}
                className="rounded-sm bg-black/40 px-1 py-0.5 text-[0.65rem] text-slate-200 disabled:opacity-30"
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
            className="flex-1 rounded-sm bg-red-600/60 px-1 py-1 text-xs text-white disabled:opacity-40"
          >
            Stop motors
          </button>
        </div>
      </div>
      <p className="mt-1 text-[0.65rem] text-slate-500">Sensor streaming auto-starts after each OI change.</p>
    </section>
  );
}

function SpeedRow({ left, right }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm bg-black/40 p-1 text-[0.7rem]">
      <div>
        <p className="text-[0.6rem] text-slate-500">Left</p>
        <p className="font-semibold text-slate-100">{left}</p>
      </div>
      <div>
        <p className="text-[0.6rem] text-slate-500">Right</p>
        <p className="font-semibold text-slate-100">{right}</p>
      </div>
    </div>
  );
}

function StatusPill({ label, active }) {
  return (
    <span
      className={`rounded-sm px-1 py-0.5 text-[0.6rem] ${
        active ? 'bg-emerald-500/30 text-emerald-100' : 'bg-black/40 text-slate-500'
      }`}
    >
      {label}
    </span>
  );
}
