// New Generation Docking HUD
// Purpose: Provides a single low-friction transition between docked, driving, and manual docking.
// Scope: Owns presentation and the existing manual-assist lifecycle for the current driver HUD;
// the archived desktop layout retains its previous DriveDockAction behavior.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaChargingStation, FaChevronDown } from 'react-icons/fa';
import { useControlActions, useControlSelector } from '../../../../controls/index.js';
import { formatKeyLabel } from '../../../../controls/keymapUtils.js';
import { useTelemetrySelector } from '../../../../context/TelemetryContext.jsx';
import { dockTelemetryEqual, resolveDocked, selectDockTelemetry } from '../../../../context/telemetryViews.js';
import { useManualDockAssist } from '../../../../features/manualDockAssist/useManualDockAssist.js';
import { useSettingsNamespace } from '../../../../settings/index.js';
import useCanControlRover from '../../../../hooks/useCanControlRover.js';
import { useDriverLayout } from '../../../../layouts/driver/DriverLayoutContext.jsx';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import KeyPill from '../../../vip/VipAudioUploadCard/KeyPill.jsx';
import ExpansionToggle from '../CornerPods/ExpansionToggle.jsx';
import usePodVisibility from '../CornerPods/usePodVisibility.js';

function DockedAction({ driveKeyLabel, pending, controlsDisabled, error, onUndock }) {
  const waitingForTurn = controlsDisabled && !pending;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6">
      <button
        type="button"
        disabled={pending || controlsDisabled}
        onClick={onUndock}
        className={`pointer-events-auto flex w-[min(32rem,80%)] flex-col items-center gap-2 px-8 py-7 text-center text-white shadow-2xl ring-2 transition focus-visible:outline-none focus-visible:ring-4 ${
          waitingForTurn
            ? 'cursor-not-allowed bg-slate-950/95 ring-slate-400/70'
            : 'bg-emerald-950/90 ring-emerald-300/80 hover:bg-emerald-900/95 focus-visible:ring-emerald-200 disabled:cursor-wait disabled:opacity-75'
        }`}
      >
        <strong className="text-3xl leading-tight">{pending ? 'Undocking…' : 'Your rover is docked'}</strong>
        {pending ? (
          null
        ) : waitingForTurn ? (
          /* A disabled action must explain the ownership constraint instead of
             continuing to advertise a click and keybind that cannot succeed. */
          <span className="text-lg font-semibold leading-snug text-slate-300">
            Wait for your turn to undock.
          </span>
        ) : (
          <span className="text-lg font-semibold leading-snug text-emerald-50">
            Click here
            {driveKeyLabel ? (
              <>
                {' '}or press <KeyPill label={driveKeyLabel} />
              </>
            ) : null}
            {' '}to undock and drive the rover
          </span>
        )}
        {error ? <span className="text-sm font-semibold text-red-200">{error}</span> : null}
      </button>
    </div>
  );
}

function AutoDockingAction({ driveKeyLabel, pending, controlsDisabled, error, onResumeDriving }) {
  const waitingForTurn = controlsDisabled && !pending;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6">
      <button
        type="button"
        disabled={pending || controlsDisabled}
        onClick={onResumeDriving}
        className={`pointer-events-auto flex w-[min(30rem,80%)] flex-col items-center gap-2 px-7 py-6 text-center text-white shadow-2xl ring-2 transition focus-visible:outline-none focus-visible:ring-4 ${
          waitingForTurn
            ? 'cursor-not-allowed bg-slate-950/95 ring-slate-400/70'
            : 'bg-amber-950/90 ring-amber-300/80 hover:bg-amber-900/95 focus-visible:ring-amber-200 disabled:cursor-wait disabled:opacity-75'
        }`}
      >
        <strong className="text-3xl leading-tight">
          {pending ? 'Starting driving…' : 'Rover is docking itself'}
        </strong>
        {pending ? null : waitingForTurn ? (
          /* Automatic docking is still important context when another user owns
             the turn, but the recovery action must not imply that it is available. */
          <span className="text-lg font-semibold leading-snug text-slate-300">
            Wait for your turn to resume driving.
          </span>
        ) : (
          <span className="text-lg font-semibold leading-snug text-amber-50">
            Click here
            {driveKeyLabel ? (
              <>
                {' '}or press <KeyPill label={driveKeyLabel} />
              </>
            ) : null}
            {' '}to stop automatic docking and resume driving
          </span>
        )}
        {error ? <span className="text-sm font-semibold text-red-200">{error}</span> : null}
      </button>
    </div>
  );
}

function DockAssistAction({ active, pending, controlsDisabled, error, dockKeyLabel, onDock, onCancel, cornerOffsetClass, open, onOpenChange, batterySeverity }) {
  const batteryUrgent = batterySeverity === 'urgent';
  const batteryLow = batterySeverity === 'low';
  if (!open) {
    return (
      <button
        type="button"
        aria-label="Show rover docking control"
        title="Dock rover"
        onClick={() => onOpenChange(true)}
        className={`pointer-events-auto absolute top-0 z-20 flex h-6 w-10 items-center justify-center gap-1 rounded-bl text-[0.6rem] transition ${
          batteryUrgent
            ? 'bg-red-950 text-red-100 hover:bg-red-900'
            : batteryLow
              ? 'bg-amber-950 text-amber-100 hover:bg-amber-900'
              : 'bg-indigo-950/75 text-indigo-100 hover:bg-indigo-900'
        } ${cornerOffsetClass === 'right-0' ? 'right-10' : cornerOffsetClass}`}
      >
        {/* The collapsed tab retains feature identity instead of becoming an
            anonymous expansion arrow whose purpose must be remembered. */}
        <FaChargingStation aria-hidden="true" />
        <FaChevronDown aria-hidden="true" />
      </button>
    );
  }

  if (active) {
    return (
      <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center">
        {/* Once assist is active, the camera image is the user's task context. Centering this
            one-line instruction connects it to that view instead of leaving guidance beside the
            corner button that already completed its action. */}
        <div className="pointer-events-auto flex items-center gap-2 rounded bg-cyan-950/60 p-1.5 text-cyan-50 shadow-xl ring-2 ring-cyan-200/90">
          <strong className="whitespace-nowrap text-sm">Dock assist is active, drive forward onto the dock.</strong>
          <button
            type="button"
            onClick={onCancel}
            disabled={controlsDisabled}
            className="bg-slate-800 px-2 py-1 text-xs font-bold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          {error ? <span className="text-xs font-semibold text-red-200">{error}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`pointer-events-auto absolute top-0 z-20 flex items-stretch ${cornerOffsetClass}`}>
      <ExpansionToggle direction="up" label="Hide dock controls" onClick={() => onOpenChange(false)} />
      <button
        type="button"
        aria-label="Start rover docking assist"
        disabled={pending || controlsDisabled}
        onClick={onDock}
        className={`flex items-center gap-1.5 rounded-bl-xl px-4 py-2 text-base font-bold shadow-xl ring-1 transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-75 ${
          batteryUrgent
            ? 'bg-red-950 text-red-50 ring-red-300/80 hover:bg-red-900 focus-visible:ring-red-200'
            : batteryLow
              ? 'bg-amber-950 text-amber-50 ring-amber-300/80 hover:bg-amber-900 focus-visible:ring-amber-200'
              : 'bg-indigo-950/60 text-indigo-50 ring-indigo-300/70 hover:bg-indigo-900 focus-visible:ring-indigo-200'
        }`}
      >
        <FaChargingStation className="shrink-0" aria-hidden="true" />
        <span>{pending ? 'Starting…' : batteryUrgent ? 'Dock now' : batteryLow ? 'Dock soon' : 'Dock rover'}</span>
        {dockKeyLabel && !pending ? <KeyPill label={dockKeyLabel} /> : null}
      </button>
      {/* The expansion toggle stays on the far side of this panel so the battery pod's
          triangular control remains unobstructed when both occupy the top-right area. */}
      {error ? <div className="mt-2 max-w-64 bg-red-950/90 px-3 py-2 text-sm font-semibold text-red-100">{error}</div> : null}
    </div>
  );
}

function UndockTransitionGhost({ onFinish }) {
  const ghostRef = useRef(null);

  useEffect(() => {
    const element = ghostRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!element || reducedMotion || typeof element.animate !== 'function') {
      onFinish();
      return undefined;
    }

    /*
      This intentionally animates a disposable visual copy instead of trying to morph the
      centered action into the differently structured corner control. Moving left/top while
      scaling and fading is inexpensive, communicates where Dock moved, and needs no viewport
      measurements or persistent layout state.
    */
    const animation = element.animate(
      [
        {
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%) scale(1)',
          opacity: 1,
        },
        {
          left: 'calc(100% - 10rem)',
          top: '0',
          transform: 'translate(0, 0) scale(0.2)',
          opacity: 0,
        },
      ],
      {
        duration: 850,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    );
    animation.onfinish = onFinish;

    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [onFinish]);

  return (
    <div
      ref={ghostRef}
      className="pointer-events-none absolute z-40 flex w-[min(32rem,80%)] origin-top-left flex-col items-center gap-2 bg-emerald-950/90 px-8 py-7 text-center text-white shadow-2xl ring-2 ring-emerald-300/80"
      style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%) scale(1)' }}
      aria-hidden="true"
    >
      <strong className="text-3xl leading-tight">Rover docked</strong>
      <span className="text-lg font-semibold text-emerald-50">Dock control moved here</span>
    </div>
  );
}

export default function DockingHud({ roverId }) {
  const layout = useDriverLayout();
  const actions = useControlActions();
  const keymap = useControlSelector((control) => control.state.keymap);
  const dockTelemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  // This replaces ManualDockAssistOverlay as the current HUD's one lifecycle owner. It preserves the
  // success sounds, camera positioning, speed cap, and automatic exit after charging begins.
  const dockAssist = useManualDockAssist({ manageLifecycle: true });
  const canControl = useCanControlRover(roverId);
  const batteryState = useSessionSelector((state) => {
    const rover = (state.session?.roster || []).find((entry) => String(entry.id) === String(roverId));
    return rover?.batteryState || null;
  });
  // DockingHud already owns the canonical desktop docking action, so battery urgency only
  // changes that action's emphasis and wording instead of introducing a competing button.
  const batterySeverity = batteryState?.urgentActive ? 'urgent' : batteryState?.warnActive ? 'low' : null;
  const { value: podSettings } = useSettingsNamespace('newdrivePods', {});
  const [dockExpansionOpen, setDockExpansionOpen] = usePodVisibility('dockAssist', true);
  // The action name is presentation state as well as busy state. Keeping the
  // reason prevents a passive, already-undocked rover from ever saying "Undocking".
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState('');
  const [showUndockTransition, setShowUndockTransition] = useState(false);

  const docked = resolveDocked(dockTelemetry);
  const oiMode = String(dockTelemetry?.oiModeLabel || '').toLowerCase();
  // The established UI contract treats exactly passive + undocked as the Roomba's
  // autonomous docking attempt. Unknown telemetry must not fabricate that state.
  const autoDocking = !docked && !dockAssist.active && oiMode === 'passive';
  const pending = pendingAction !== null;
  /* Mobile already presents its own touch-oriented driving controls. The docked
     action therefore keeps its plain-language instruction without advertising a
     keyboard shortcut that is irrelevant on that layout. */
  const driveKeyLabel = layout === 'desktop'
    ? formatKeyLabel(keymap?.driveMacro?.[0])
    : '';
  const dockKeyLabel = layout === 'desktop'
    ? formatKeyLabel(keymap?.dockMacro?.[0])
    : '';
  const batteryPodOpen = podSettings?.battery !== false;
  // The camera arc is the shared circular-pod reference size. Keep the dock expansion flush
  // against the battery shell after enlarging that gauge to the same 8.5-rem footprint.
  const cornerOffsetClass = batteryPodOpen ? 'right-[8.5rem]' : 'right-0';
  const previousDockedRef = useRef(docked);
  const finishUndockTransition = useCallback(() => setShowUndockTransition(false), []);

  useEffect(() => {
    const wasDocked = previousDockedRef.current;
    // Only a real live transition plays the cue. An already-undocked rover must not animate
    // merely because the user opened or refreshed the page.
    if (wasDocked && !docked) {
      setShowUndockTransition(true);
    } else if (docked) {
      setShowUndockTransition(false);
    }
    previousDockedRef.current = docked;
  }, [docked]);

  const startDriving = async (action) => {
    if (!roverId || pending || !canControl) return;
    setPendingAction(action);
    setError('');
    try {
      // The established drive sequence is the canonical undock path: it restores the camera,
      // enters full Open Interface mode, and performs the short physical back-away from the dock.
      dockAssist.exitAssist();
      actions.setMode('drive');
      await actions.runMacro('drive-sequence');
    } catch (caughtError) {
      setError(caughtError?.message || 'Unable to start driving. Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const startUndocking = () => {
    startDriving('undocking');
  };
  const resumeDriving = () => {
    startDriving('resuming');
  };

  const startDocking = () => {
    if (!roverId || pending || !canControl) return;
    setError('');
    try {
      // Enter on the first click. The explanation appears as the resulting active state instead
      // of forcing the user through a modal and a second confirmation action.
      dockAssist.enterAssist();
    } catch (caughtError) {
      setError(caughtError?.message || 'Unable to start dock assist. Please try again.');
    }
  };

  return (
    <>
      {/* This single layer both dims and blocks the ordinary rover HUD. A passive
          undocked rover is still moving autonomously, so it gets a lighter but equally
          blocking shield. Explicit pending state keeps the correct shield mounted until
          the complete drive sequence finishes even as telemetry changes underneath it. */}
      <div
        className={`absolute inset-0 z-[25] transition-all duration-300 ${
          docked || pendingAction === 'undocking'
            ? 'pointer-events-auto bg-black/75 opacity-100'
            : autoDocking || pendingAction === 'resuming'
              ? 'pointer-events-auto bg-black/55 opacity-100'
              : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
      />

      {docked || pendingAction === 'undocking' ? (
        <DockedAction
          driveKeyLabel={driveKeyLabel}
          pending={pendingAction === 'undocking'}
          controlsDisabled={!canControl}
          error={error}
          onUndock={startUndocking}
        />
      ) : autoDocking || pendingAction === 'resuming' ? (
        <AutoDockingAction
          driveKeyLabel={driveKeyLabel}
          pending={pendingAction === 'resuming'}
          controlsDisabled={!canControl}
          error={error}
          onResumeDriving={resumeDriving}
        />
      ) : (
        <>
          {dockAssist.active ? (
            /* Dock assist needs the unobscured camera image. A thin cyan frame communicates the
                temporary mode without adding another instruction surface over the video. */
            <div className="pointer-events-none absolute inset-0 z-50 ring-8 ring-inset ring-cyan-200/90" aria-hidden="true" />
          ) : null}
          {/* Desktop keeps the compact corner entry point. Mobile starts assist from
              its dedicated control column, but once active it still mounts this component
              so the centered camera instruction and cancel action remain available. */}
          {layout === 'desktop' || dockAssist.active ? (
            <DockAssistAction
              active={dockAssist.active}
              pending={pending}
              controlsDisabled={!canControl}
              error={error}
              dockKeyLabel={dockKeyLabel}
              onDock={startDocking}
              onCancel={dockAssist.exitAssist}
              cornerOffsetClass={cornerOffsetClass}
              open={dockExpansionOpen}
              onOpenChange={setDockExpansionOpen}
              batterySeverity={batterySeverity}
            />
          ) : null}
          {showUndockTransition ? <UndockTransitionGhost onFinish={finishUndockTransition} /> : null}
        </>
      )}
    </>
  );
}
