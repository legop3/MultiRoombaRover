// Drive Dock Action
// Purpose: Defines the Drive Dock Action module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { useTelemetryFrame } from '../../context/TelemetryContext.jsx';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';

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
          <p className="text-lg font-semibold text-indigo-50">Manual Docking Assist</p>
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
            {pending ? 'Starting…' : 'Enter Assist'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DriveDockAction({
  layout = 'desktop',
  expand = false,
  fill = false,
  driveDockState,
  compactHeightClass = '',
}) {
  const isMobile = layout === 'mobile';
  const {
    state: { roverId, keymap },
    actions,
  } = useControlSystem();
  const dockAssist = useManualDockAssist();
  const frame = useTelemetryFrame(roverId);
  const state = driveDockState ?? deriveDriveDockState(frame);
  const { driving, docked, charging, dockingInProgress } = state;
  const [pending, setPending] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const manualAssistActive = Boolean(dockAssist.active);

  const driveDisabled = !roverId || pending !== null;
  const dockDisabled = !roverId || pending !== null;

  const driveKeyLabel = formatKeyLabel(keymap?.driveMacro?.[0]);
  const dockKeyLabel = formatKeyLabel(keymap?.dockMacro?.[0]);

  const dockInstructions = {
    summary: 'Use assist mode to manually line up with the dock.',
    steps: [
      'Line up the center dot of your rover with the center of the dock',
      'The UI will indicate when you are successfully docked',
      'When good contact is made, charging will start in about 5 seconds.',
    ],
  };

  const startDriveInstructions = {
    summary: 'You must enable driving mode before you can move the rover.',
    steps: ['Press the keybind or tap this button to enable driving mode', 'Once ready (should be instant), this dialog will change, and you will be able to move'],
  };
  const dockValue = docked ? 'Docked' : 'Undocked';
  const dockTone = docked ? 'good' : 'bad';
  const chargeValue = charging ? 'Charging' : docked ? 'Charging soon...' : '—';
  const chargeTone = charging ? 'good' : docked ? 'warn' : 'bad';

  const handleReturnToDrive = async () => {
    if (!roverId || pending) return;
    setPending('drive');
    try {
      dockAssist.exitAssist();
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
      dockAssist.exitAssist();
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
      dockAssist.enterAssist();
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
    if (manualAssistActive) {
      dockAssist.exitAssist();
      return;
    }
    setShowModal(true);
    setConfirmOpen(true);
  };

  const baseCardClasses =
    'flex w-full flex-col gap-0.5 overflow-hidden rounded-xl border-2 px-0.75 py-0.75 text-slate-100 shadow-md transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 select-none no-touch-select';
  const ctaText = 'text-center';
  const ctaLayout = 'items-center justify-between';
  const compactLayout = 'items-center justify-center';
  const ctaSize = isMobile ? 'text-sm font-semibold' : '';
  const emeraldCta =
    'border-emerald-300/70 bg-emerald-800 text-emerald-50 hover:bg-emerald-700 focus-visible:ring-emerald-300';
  const amberCta =
    'border-amber-300/70 bg-amber-900 text-amber-50 hover:bg-amber-800 focus-visible:ring-amber-300';
  const indigoCta =
    'border-indigo-300/70 bg-indigo-900 text-indigo-50 hover:bg-indigo-800 focus-visible:ring-indigo-300';
  const cyanCta =
    'border-cyan-300/70 bg-cyan-900 text-cyan-50 hover:bg-cyan-800 focus-visible:ring-cyan-300';
  const orangeCta =
    'border-amber-300/70 bg-amber-900 text-amber-50 hover:bg-amber-800 focus-visible:ring-amber-300';
  const forceExpanded = dockingInProgress;
  const expanded = expand || forceExpanded;
  const filledHeight = expanded ? 'h-full flex-1' : fill ? 'flex-1' : '';
  const compactHeight = isMobile && !expanded ? compactHeightClass : '';
  const layoutClass = isMobile && !expanded ? compactLayout : ctaLayout;
  const compactDockedDriving = isMobile && !expanded && driving && docked;

  if (!driving && !dockingInProgress) {
    return (
      <button
        type="button"
        onClick={handleStartDrive}
        onContextMenu={(event) => event.preventDefault()}
        disabled={driveDisabled}
        className={`${baseCardClasses} ${filledHeight} ${compactHeight} ${ctaText} ${layoutClass} ${ctaSize} ${emeraldCta}`}
      >
        <div className="space-y-0.5 w-full">
          <div className="flex w-full flex-col items-center gap-0.25">
            <span className="text-base font-semibold text-emerald-50 md:text-lg">Start Driving</span>
            {!isMobile && expanded ? (
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                {driveKeyLabel ? <KeyPill label={driveKeyLabel} /> : null}
                <ActionPill label="Click to start" tone="emerald" />
              </div>
            ) : null}
          </div>
          {expanded ? (
            <>
              <p className="text-sm text-emerald-50/90">{startDriveInstructions.summary}</p>
              <StepList steps={startDriveInstructions.steps} tone="emerald" />
            </>
          ) : null}
        </div>
        {expanded ? (
          <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
            <StatusRow label="Dock" value={dockValue} tone={dockTone} />
            <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
          </div>
        ) : null}
      </button>
    );
  }

  if (dockingInProgress) {
    const inProgressCopy = {
      summary: 'The rover is currently attempting to dock itself due to being idle.',
      steps: ['Click to return to driving mode.'],
    };

    return (
      <button
        type="button"
        disabled={driveDisabled}
        onClick={handleReturnToDrive}
        onContextMenu={(event) => event.preventDefault()}
        className={`${baseCardClasses} ${filledHeight} ${compactHeight} ${ctaText} ${layoutClass} ${ctaSize} ${amberCta}`}
      >
        <div className="space-y-0.5 w-full">
          <div className="flex w-full flex-col items-center gap-0.25">
            <span className="text-base font-semibold text-amber-50 md:text-lg">Attempting to auto-dock...</span>
            {/* {!isMobile && expanded ? ( */}
            {expanded ? (
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                <ActionPill label="Return to driving mode" tone="emerald" />
              </div>
            ) : null}
          </div>
          {expanded ? <p className="text-sm text-amber-50/90">{inProgressCopy.summary}</p> : null}
        </div>
        {expanded ? (
          <>
            <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
              <StatusRow label="Dock" value={dockValue} tone={dockTone} />
              <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
            </div>
            {!isMobile ? (
              <StepList steps={inProgressCopy.steps} tone="amber" />
            ) : null}
          </>
        ) : null}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={dockDisabled}
        onClick={handleOpenDock}
        onContextMenu={(event) => event.preventDefault()}
        className={
          isMobile
            ? `flex w-full ${baseCardClasses} ${compactHeight} ${ctaText} ${layoutClass} ${ctaSize} ${
                manualAssistActive ? cyanCta : compactDockedDriving ? orangeCta : indigoCta
              }`
            : `${baseCardClasses} ${filledHeight} ${ctaText} ${ctaLayout} ${ctaSize} ${manualAssistActive ? cyanCta : indigoCta}`
        }
      >
        <div className="flex w-full flex-col items-center gap-0.25">
          <span className="text-base font-semibold text-indigo-50 md:text-lg">
            {compactDockedDriving ? 'Docked!' : manualAssistActive ? 'Exit Docking Assist' : 'Dock and charge'}
          </span>
          {!isMobile && expanded ? (
            <div className="flex flex-wrap items-center justify-center gap-0.5">
              {dockKeyLabel ? <KeyPill label={dockKeyLabel} /> : null}
              <ActionPill label={manualAssistActive ? 'Click to exit assist' : 'Click to enable assist'} tone="indigo" />
            </div>
          ) : null}
        </div>
        {!isMobile && expanded && (
          <>
            <StepList steps={dockInstructions.steps} tone="indigo" />
            <div className="flex w-full flex-1 flex-col gap-0.5 self-stretch">
              <StatusRow label="Dock" value={dockValue} tone={dockTone} />
              <StatusRow label="Charge" value={chargeValue} tone={chargeTone} />
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
