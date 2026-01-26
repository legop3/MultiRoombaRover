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

function StatusRow({ label, value, tone = 'neutral' }) {
  const toneClasses =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-600 text-white'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-600 text-white'
        : tone === 'bad'
          ? 'border-red-200 bg-red-600 text-white'
          : 'border-slate-200/30 bg-slate-700 text-slate-100';
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center rounded-lg border px-0.75 py-0.5 text-center ${toneClasses}`}
    >
      <span className="text-base font-semibold md:text-lg">{value}</span>
    </div>
  );
}

function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-white/40 px-1 text-[0.7rem] text-white">{label}</span>;
}

function ActionPill({ label, tone }) {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-200/70 bg-emerald-600/70 text-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200/70 bg-amber-600/70 text-amber-50'
        : 'border-indigo-200/70 bg-indigo-600/70 text-indigo-50';
  return (
    <span
      className={`rounded-full border px-0.5 py-0.15 text-[0.7rem] font-semibold ${toneClasses}`}
    >
      {label}
    </span>
  );
}

function DockModal({ instructions, onConfirm, onCancel, pending }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-1">
      <div className="surface w-full max-w-md space-y-0.5 border border-indigo-700 bg-indigo-950/90 p-1 text-slate-100 shadow-2xl">
        <div className="space-y-0.5">
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
  const { driving, docked, charging, dockingInProgress } = state;
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
  const dockValue = docked ? 'Docked' : 'Undocked';
  const dockTone = docked ? 'good' : 'bad';
  const chargeValue = charging ? 'Charging' : docked ? 'Not charging yet' : '—';
  const chargeTone = charging ? 'good' : docked ? 'warn' : 'bad';

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
    'flex w-full flex-col gap-0.5 overflow-hidden rounded-xl border-2 px-0.75 py-0.75 text-slate-100 shadow-md transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60';
  const ctaText = 'text-center';
  const ctaLayout = 'items-center justify-between';
  const ctaTextAndLayout = `${ctaText} ${ctaLayout}`;
  const ctaSize = isMobile ? 'text-sm font-semibold' : '';
  const emeraldCta =
    'border-emerald-300/70 bg-emerald-800 text-emerald-50 hover:bg-emerald-700 focus-visible:ring-emerald-300';
  const amberCta =
    'border-amber-300/70 bg-amber-900 text-amber-50 hover:bg-amber-800 focus-visible:ring-amber-300';
  const indigoCta =
    'border-indigo-300/70 bg-indigo-900 text-indigo-50 hover:bg-indigo-800 focus-visible:ring-indigo-300';
  const filledHeight = expand ? 'h-full flex-1' : '';

  if (!driving && !dockingInProgress) {
    return (
      <button
        type="button"
        onClick={handleStartDrive}
        disabled={driveDisabled}
        className={`${baseCardClasses} ${filledHeight} ${ctaTextAndLayout} ${ctaSize} ${emeraldCta}`}
      >
        <div className="space-y-0.5 w-full">
          <div className="flex w-full flex-col items-center gap-0.25">
            <span className="text-base font-semibold text-emerald-50 md:text-lg">Start Driving</span>
            {!isMobile ? (
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                {driveKeyLabel ? <KeyPill label={driveKeyLabel} /> : null}
                <ActionPill label="Click to start" tone="emerald" />
              </div>
            ) : null}
          </div>
          <p className="text-sm text-emerald-50/90">{startDriveInstructions.summary}</p>
          <StepList steps={startDriveInstructions.steps} tone="emerald" />
        </div>
        <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
          <StatusRow label="Dock" value={dockValue} tone={dockTone} />
          <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
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
        className={`${baseCardClasses} ${filledHeight} ${ctaTextAndLayout} ${ctaSize} ${amberCta}`}
      >
        <div className="space-y-0.5 w-full">
          <div className="flex w-full flex-col items-center gap-0.25">
            <span className="text-base font-semibold text-amber-50 md:text-lg">Docking in Progress</span>
            {!isMobile ? (
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                <ActionPill label="Click to return to driving mode" tone="amber" />
              </div>
            ) : null}
          </div>
          <p className="text-sm text-amber-50/90">{inProgressCopy.summary}</p>
        </div>
        <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
          <StatusRow label="Dock" value={dockValue} tone={dockTone} />
          <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
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
            ? `flex w-full items-center justify-center ${baseCardClasses} ${ctaTextAndLayout} ${ctaSize} ${indigoCta}`
            : `${baseCardClasses} ${filledHeight} ${ctaTextAndLayout} ${ctaSize} ${indigoCta}`
        }
      >
        <div className="flex w-full flex-col items-center gap-0.25">
          <span className="text-base font-semibold text-indigo-50 md:text-lg">Dock and Charge</span>
          {!isMobile ? (
            <div className="flex flex-wrap items-center justify-center gap-0.5">
              {dockKeyLabel ? <KeyPill label={dockKeyLabel} /> : null}
              <ActionPill label="Click to begin docking" tone="indigo" />
            </div>
          ) : null}
        </div>
        {!isMobile && (
          <>
            <p className="text-sm text-indigo-50/90">{dockButtonCaption}</p>
            <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
              <StatusRow label="Dock" value={dockValue} tone={dockTone} />
              <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
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
            <span className={`mr-0 align-top text-[0.75rem] font-semibold ${numberColor}`}>{idx + 1}.</span>
            <span className="align-top">{step}</span>
          </div>
          {idx < steps.length - 1 ? <div className="mt-0 h-px bg-white/10" /> : null}
        </div>
      ))}
    </div>
  );
}
