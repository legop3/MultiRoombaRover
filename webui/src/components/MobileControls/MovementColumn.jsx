// Movement Column
// Purpose: Assembles the mobile movement column, which is the right column by default.
// Scope: Owns movement availability while the in-video DockingHud owns every dock/undock action.
import { FaChargingStation } from 'react-icons/fa';
import { useControlSelector } from '../../controls/index.js';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';
import { dockTelemetryEqual, resolveDocked, selectDockTelemetry } from '../../context/telemetryViews.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import useCanControlRover from '../../hooks/useCanControlRover.js';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';
import ControlPadPanel from './ControlPadPanel.jsx';

function MovementColumnContent({ layout }) {
  const roverId = useControlSelector((control) => control.state.roverId);
  const dockTelemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  const dockAssist = useManualDockAssist();
  const canControl = useCanControlRover(roverId);
  const batteryState = useSessionSelector((state) => {
    const rover = (state.session?.roster || []).find((entry) => String(entry.id) === String(roverId));
    return rover?.batteryState || null;
  });
  const batteryUrgent = Boolean(batteryState?.urgentActive);
  const batteryLow = Boolean(batteryState?.warnActive || batteryUrgent);
  const docked = resolveDocked(dockTelemetry);
  const drivingMode = String(dockTelemetry?.oiModeLabel || '').toLowerCase() === 'full';

  /*
    DockingHud is now the only place where a user starts driving or enters docking
    assist. This column only decides whether touch movement is safe. Requiring both
    an undocked rover and full OI mode keeps the pad inert throughout the undock
    macro, including the interval where dock contact and OI mode change separately.

    Manual assist is the deliberate exception to the normal OI-mode requirement:
    its entire purpose is to let the user drive onto the dock under the assist speed
    cap. Actual dock contact still disables movement immediately.
  */
  const movementDisabled = !roverId
    || !canControl
    || docked
    || (!drivingMode && !dockAssist.active);
  // Both controls share the same hardware-availability boundary. Dock assist
  // changes their actions, not who is allowed to command the rover.
  const dockActionDisabled = movementDisabled;

  const handleDockAction = () => {
    if (dockActionDisabled) return;
    triggerTouchHaptic('button');
    // Mobile deliberately enters assist on the first tap. The centered video HUD
    // provides the resulting instruction, so a confirmation modal would only add
    // friction between intent and the camera-guided docking task.
    if (dockAssist.active) {
      dockAssist.exitAssist();
    } else {
      dockAssist.enterAssist();
    }
  };

  return (
    <div className="mobile-touch-control flex h-full flex-col gap-0.5 text-slate-100" data-mobile-layout={layout}>
      <button
        type="button"
        disabled={dockActionDisabled}
        onClick={handleDockAction}
        className={`mobile-touch-control flex min-h-[4.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 px-2 text-base font-semibold shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 ${
          dockAssist.active
            ? 'border-cyan-300/70 bg-cyan-900 text-cyan-50'
            : batteryUrgent
              ? 'border-red-300/80 bg-red-950 text-red-50'
              : batteryLow
                ? 'border-amber-300/80 bg-amber-950 text-amber-50'
                : 'border-indigo-300/70 bg-indigo-900 text-indigo-50'
        }`}
      >
        <FaChargingStation className="text-lg" aria-hidden="true" />
        {/* The mobile column remains the only mobile entry point into dock assist. Battery
            severity makes that existing action more obvious without adding another control. */}
        <span>{dockAssist.active ? 'Exit dock assist' : batteryUrgent ? 'Dock now' : batteryLow ? 'Dock and charge soon' : 'Dock and charge'}</span>
      </button>
      {/* Keeping the pad mounted prevents the mobile columns from changing size while
          the centered video HUD explains and performs dock-related transitions. */}
      <ControlPadPanel disabled={movementDisabled} />
    </div>
  );
}

export default function MovementColumn({ layout, className = '' }) {
  return (
    <div className={`mobile-touch-control flex flex-col gap-0.5 ${className}`.trim()} data-mobile-layout={layout}>
      <MovementColumnContent layout={layout === 'landscape' ? 'landscape' : 'portrait'} />
    </div>
  );
}
