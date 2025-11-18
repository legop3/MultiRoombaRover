import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { useControlSystem } from '../controls/index.js';

export default function DrivePanel() {
  const {
    state: { roverId },
    actions,
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const drivingMode = (sensors.oiMode?.label || '').toLowerCase() === 'full';
  const docked = Boolean(sensors.chargingSources?.homeBase);
  const charging = Boolean(
    sensors.chargingState?.label && sensors.chargingState.label.toLowerCase() !== 'not charging',
  );

  const handleStartDrive = () => {
    if (!roverId) return;
    actions.setMode('drive');
    actions.runMacro('drive-sequence');
  };

  const handleDock = () => {
    if (!roverId) return;
    actions.setMode('dock');
    actions.runMacro('seek-dock');
  };

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>Drive control</span>
        <span>{roverId ? 'Ready to drive' : 'No rover assigned'}</span>
      </div>
      <div className="space-y-0.5">
        <ActionCard
          title="Start Driving"
          description="Press to enable driving mode, then start moving. The headlamps should illuminate."
          statuses={[{ label: drivingMode ? 'Ready!' : 'Not Ready!', active: drivingMode }]}
          tone="emerald"
          onClick={handleStartDrive}
          disabled={!roverId}
        />
        <ActionCard
          title="Dock and Charge"
          description="Line the rover up about a foot from the dock, then trigger an automatic approach."
          statuses={[
            { label: docked ? 'Docked!' : 'Not Docked!', active: docked },
            { label: charging ? 'Charging!' : 'Not Charging!', active: charging },
          ]}
          tone="indigo"
          onClick={handleDock}
          disabled={!roverId}
        />
      </div>
    </section>
  );
}

function ActionCard({ title, description, statuses, tone, onClick, disabled, footnote }) {
  const colors =
    tone === 'indigo'
      ? { base: 'bg-indigo-600', hover: 'hover:bg-indigo-500' }
      : { base: 'bg-emerald-600', hover: 'hover:bg-emerald-500' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full ${colors.base} ${colors.hover} px-0.5 py-0.5 text-left text-white transition-colors disabled:opacity-40`}
    >
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-white/90">{description}</p>
      <div className="mt-0.5 flex flex-wrap gap-0.5">
        {statuses.map((status) => (
          <span
            key={status.label}
            className={`px-0.5 py-0.5 text-xs font-semibold ${
              status.active ? 'bg-lime-300 text-emerald-900' : 'bg-emerald-900 text-emerald-100'
            }`}
          >
            {status.label}
          </span>
        ))}
      </div>
      {footnote && <p className="mt-0.5 text-xs text-emerald-50/80">{footnote}</p>}
    </button>
  );
}
