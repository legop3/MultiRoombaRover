import { useMemo, useState } from 'react';
import { useControlSystem } from '../controls/index.js';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import { formatKeyLabel } from '../controls/keymapUtils.js';

export function deriveDriveDockState(frame) {
  const sensors = frame?.sensors || {};
  const oiLabel = sensors.oiMode?.label || 'Unknown';
  const oiNormalized = oiLabel.toLowerCase();
  const chargingLabel = sensors.chargingState?.label || '';
  const docked = Boolean(sensors.chargingSources?.homeBase);
  const charging = docked && chargingLabel.toLowerCase() !== 'not charging' && chargingLabel !== '';
  const driving = oiNormalized === 'full';
  const dockedNotCharging = docked && !charging;
  const dockingInProgress = !docked && !charging && oiNormalized === 'passive';
  return { driving, docked, charging, dockedNotCharging, dockingInProgress, oiLabel, chargingLabel };
}

export function useDriveDockState(roverId) {
  const frame = useTelemetryFrame(roverId);
  return useMemo(() => deriveDriveDockState(frame), [frame]);
}

function StatusPill({ label, active }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[0.75rem] font-semibold ${
        active ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {label}
    </span>
  );
}

function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}

function DockModal({ instructions, onConfirm, onCancel, pending }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-1">
      <div className="surface w-full max-w-md space-y-0.5 border border-indigo-700 bg-indigo-950/90 p-1 text-slate-100 shadow-2xl">
        <div className="space-y-0.25">
          <p className="text-lg font-semibold text-indigo-50">Dock Rover</p>
          <p className="text-sm text-slate-200">{instructions.summary}</p>
          <StepList steps={instructions.steps} tone="indigo" />
        </div>
        <div className="grid grid-cols-2 gap-0.5 text-sm">
          <button
            type="button"
            onClick={onCancel}
            className="bg-slate-700 px-0.5 py-1 font-semibold text-slate-100 transition hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="bg-indigo-600 px-0.5 py-1 font-semibold text-indigo-50 transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {pending ? 'Docking…' : 'Confirm Dock'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DriveDockAction({ layout = 'desktop', expand = false, driveDockState }) {
  const isMobile = layout === 'mobile';
  const {
    state: { roverId, keymap },
    actions,
  } = useControlSystem();
  const frame = useTelemetryFrame(roverId);
  const state = driveDockState ?? deriveDriveDockState(frame);
  const { driving, docked, charging, dockedNotCharging, dockingInProgress, oiLabel } = state;
  const [pending, setPending] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const driveDisabled = !roverId || pending !== null;
  const dockDisabled = !roverId || pending !== null;

  const driveKeyLabel = formatKeyLabel(keymap?.driveMacro?.[0]);
  const dockKeyLabel = formatKeyLabel(keymap?.dockMacro?.[0]);

  const dockInstructions = {
    summary: 'You are about to trigger an automatic docking attempt! To have a successful dock:',
    steps: ['Line up the rover straight in front of the dock', 'Make sure the rover is about one foot or half a meter away from the dock', 'Press Confirm Dock to begin the docking process'],
  };
  const dockButtonCaption = 'Click this button to initate auto-dock.';

  const startDriveInstructions = {
    summary: 'You must enable driving mode before you can move the rover.',
    steps: ['Press the keybind or tap this button to enable driving mode', 'Once ready (should be instant), this dialog will change, and you will be able to move'],
  };

  const handleReturnToDrive = async () => {
    if (!roverId || pending) return;
    setPending('drive');
    try {
      actions.setMode('drive');
      await actions.runMacro('drive-sequence');
    } catch (err) {
      alert(err.message);
    } finally {
      setPending(null);
    }
  };

  const handleStartDrive = async () => {
    if (!roverId || pending) return;
    setConfirmOpen(false);
    setShowModal(false);
    setPending('drive');
    try {
      actions.setMode('drive');
      await actions.runMacro('drive-sequence');
    } catch (err) {
      alert(err.message);
    } finally {
      setPending(null);
    }
  };

  const handleConfirmDock = async () => {
    if (!roverId || pending) return;
    setPending('dock');
    try {
      actions.setMode('dock');
      await actions.runMacro('seek-dock');
    } catch (err) {
      alert(err.message);
    } finally {
      setPending(null);
      setConfirmOpen(false);
      setShowModal(false);
    }
  };

  const handleOpenDock = () => {
    if (dockDisabled) return;
    setShowModal(true);
    setConfirmOpen(true);
  };

  const baseCardClasses =
    'flex w-full flex-col gap-0.5 border border-slate-700 px-0.75 py-0.75 text-slate-100 shadow';
  const filledHeight = expand ? 'h-full flex-1' : '';

  if (!driving && !dockingInProgress) {
    return (
      <button
        type="button"
        onClick={handleStartDrive}
        disabled={driveDisabled}
        className={`${baseCardClasses} ${filledHeight} items-center justify-between bg-emerald-800 hover:bg-emerald-700 text-center transition disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <div className="space-y-0.25 w-full">
          <div className="flex items-center justify-center gap-0.5">
            <span className="text-base font-semibold text-emerald-50">Start Driving</span>
            {!isMobile && driveKeyLabel ? <KeyPill label={driveKeyLabel} /> : null}
          </div>
          <p className="text-sm text-emerald-50/90">{startDriveInstructions.summary}</p>
          <StepList steps={startDriveInstructions.steps} tone="emerald" />
        </div>
        <div className="flex w-full flex-col gap-0.5">
          <StatusPill label={`OI: ${oiLabel}`} active={oiLabel.toLowerCase() === 'full'} />
          <StatusPill label={docked ? 'Docked!' : 'Not docked'} active={docked} />
          <StatusPill label={charging ? 'Charging!' : 'Not charging'} active={charging} />
        </div>
      </button>
    );
  }

  if (dockingInProgress) {
    const inProgressCopy = {
      summary: 'Docking attempt in progress.',
      steps: ['The rover should be slowly wiggling towards the dock', 'If it is obviously not working, press this button to enter driving mode and try again'],
    };

    return (
      <button
        type="button"
        disabled={driveDisabled}
        onClick={handleReturnToDrive}
        className={`${baseCardClasses} ${filledHeight} items-center bg-amber-900 text-center transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <div className="space-y-0.25 w-full">
          <div className="flex items-center justify-center gap-0.5">
            <span className="text-base font-semibold text-amber-50">Docking in Progress</span>
          </div>
          <p className="text-sm text-amber-50/90">{inProgressCopy.summary}</p>
        </div>
        <div className="flex w-full flex-col gap-0.5">
          <StatusPill label={docked ? 'Docked' : 'Not docked'} active={docked} />
          <StatusPill label={charging ? 'Charging' : 'Not charging'} active={charging} />
        </div>
        <StepList steps={inProgressCopy.steps} tone="amber" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={dockDisabled}
        onClick={handleOpenDock}
        className={
          isMobile
            ? 'flex w-full items-center justify-center border border-slate-700 bg-indigo-900 px-0.75 py-0.75 text-sm font-semibold text-indigo-50 shadow transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50'
            : `${baseCardClasses} ${filledHeight} items-center bg-indigo-900 text-center transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50`
        }
      >
        <div className="flex items-center justify-center gap-0.5 w-full">
          <span className="text-base font-semibold text-indigo-50">Dock and Charge</span>
          {!isMobile && dockKeyLabel ? <KeyPill label={dockKeyLabel} /> : null}
        </div>
        {!isMobile && (
          <>
            <p className="text-sm text-indigo-50/90">{dockButtonCaption}</p>
            <div className="flex w-full flex-col gap-0.5">
              <StatusPill label={docked ? 'Docked' : 'Not docked'} active={docked} />
              <StatusPill label={charging ? 'Charging' : 'Not charging'} active={charging} />
              {dockedNotCharging ? (
                <StatusPill label="Not charging yet" active={false} />
              ) : null}
            </div>
            <div className="text-xs text-indigo-100/80">
              Line up straight, about 1 foot away, before docking.
            </div>
          </>
        )}
      </button>
      {showModal || (!isMobile && confirmOpen) ? (
        <DockModal
          instructions={dockInstructions}
          pending={pending === 'dock'}
          onCancel={() => {
            setShowModal(false);
            setConfirmOpen(false);
          }}
          onConfirm={handleConfirmDock}
        />
      ) : null}
    </>
  );
}

function StepList({ steps, tone = 'emerald' }) {
  const container =
    tone === 'emerald'
      ? 'bg-emerald-900/60 text-emerald-50/90 border-emerald-700/60'
      : tone === 'amber'
        ? 'bg-amber-900/60 text-amber-50/90 border-amber-700/60'
        : 'bg-indigo-900/60 text-indigo-50/90 border-indigo-700/60';
  const numberColor =
    tone === 'emerald'
      ? 'text-emerald-200'
      : tone === 'amber'
        ? 'text-amber-200'
        : 'text-indigo-200';
  return (
    <div className={`space-y-0.5 rounded border px-0.5 py-0.35 text-left ${container}`}>
      {steps.map((step, idx) => (
        <div key={step} className="text-[0.85rem] leading-snug break-words">
          <div className="flex items-start">
            <span className={`mr-0.35 align-top text-[0.75rem] font-semibold ${numberColor}`}>{idx + 1}.</span>
            <span className="align-top">{step}</span>
          </div>
          {idx < steps.length - 1 ? <div className="mt-0.35 h-px bg-white/10" /> : null}
        </div>
      ))}
    </div>
  );
}
