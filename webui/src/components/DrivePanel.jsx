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
    <section className="rounded-sm bg-[#242a32] p-1 text-sm text-slate-100">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Drive control</span>
        <span>{roverId ? `Rover ${roverId}` : 'unassigned'}</span>
      </div>
      <div className="mt-1 space-y-1">
        <ActionCard
          title="Start Driving"
          description="Press to enable driving mode, then start moving. The headlamps should illuminate."
          statuses={[{ label: drivingMode ? 'Ready!' : 'Not Ready!', active: drivingMode }]}
          gradient="from-emerald-600 to-emerald-400"
          onClick={runStartDockFull}
          disabled={!roverId}
          footnote={updated ? `Sensor ping ${updated}` : null}
        />
        <ActionCard
          title="Dock and Charge"
          description="Line the rover up about a foot from the dock, then trigger an automatic approach."
          statuses={[
            { label: docked ? 'Docked!' : 'Not Docked!', active: docked },
            { label: charging ? 'Charging!' : 'Not Charging!', active: charging },
          ]}
          gradient="from-indigo-600 to-purple-500"
          onClick={seekDock}
          disabled={!roverId}
        />
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

function ActionCard({ title, description, statuses, gradient, onClick, disabled, footnote }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg bg-gradient-to-r ${gradient} px-2 py-2 text-left text-white disabled:opacity-40`}
    >
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-emerald-50/80">{description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {statuses.map((status) => (
          <span
            key={status.label}
            className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
              status.active ? 'bg-lime-300 text-emerald-900' : 'bg-emerald-900 text-emerald-100'
            }`}
          >
            {status.label}
          </span>
        ))}
      </div>
      {footnote && <p className="mt-1 text-xs text-emerald-50/80">{footnote}</p>}
    </button>
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
