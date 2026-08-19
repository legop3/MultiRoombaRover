// Aux Column
// Purpose: Assembles the mobile auxiliary controls column, which is the left column by default.
// Scope: Owns mobile aux/camera/headlight/laser/horn wiring while reusing desktop variation components where intended.
import { useCallback, useEffect, useRef } from 'react';
import { FaBullhorn, FaCrosshairs, FaLightbulb } from 'react-icons/fa';
import './mobileControls.css';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { useTelemetrySelector } from '../../context/TelemetryContext.jsx';
import { dockTelemetryEqual, selectDockTelemetry } from '../../context/telemetryViews.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import useCanControlRover from '../../hooks/useCanControlRover.js';
import HornControl from '../HornControl/index.jsx';
import GPIOToggleControl from '../GPIOToggleControl/index.jsx';
import { AUX_ZERO } from './constants.js';
import VacuumControls from './VacuumControls.jsx';
import VerticalCameraTilt from './VerticalCameraTilt.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';

const CAMERA_TILT_STEP_DEGREES = 0.5;
const CAMERA_TILT_PRECISION_STEP_DEGREES = 0.1;

function AuxColumnContent() {
  const roverId = useControlSelector((control) => control.state.roverId);
  const roomLightsLockedOn = useSessionSelector((state) => Boolean(state.session?.homeAssistant?.lightPolicy?.lockedOn));
  const camera = useControlSelector((control) => control.state.camera);
  const horn = useControlSelector((control) => control.state.horn);
  const headlight = useControlSelector((control) => control.pipeline?.headlight);
  const headlightState = useControlSelector((control) => control.pipeline?.headlightState);
  const laser = useControlSelector((control) => control.pipeline?.laser);
  const laserState = useControlSelector((control) => control.pipeline?.laserState);
  const pipelineHorn = useControlSelector((control) => control.pipeline?.horn);
  const { setServoAngle, setHeadlight, setLaser, setAuxMotors, startHorn, stopHorn } = useControlActions();
  const dockAssist = useManualDockAssist();
  const dockTelemetry = useTelemetrySelector(roverId, selectDockTelemetry, dockTelemetryEqual);
  const canControl = useCanControlRover(roverId);
  // Turn ownership is the common mutation boundary for every control in this
  // column. Dock and OI state are applied separately only where the hardware
  // command itself depends on the Roomba being able to drive.
  const controlsDisabled = !roverId || !canControl;
  const docked = Boolean(dockTelemetry?.homeBase);
  const drivingMode = String(dockTelemetry?.oiModeLabel || '').toLowerCase() === 'full';
  const vacuumDisabled = controlsDisabled
    || docked
    || (!drivingMode && !dockAssist.active);
  const activeAuxButtonRef = useRef(null);
  const cameraConfig = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && cameraConfig);
  const headlightAvailable = Boolean(roverId && headlight);
  const laserAvailable = Boolean(roverId && laser);
  const hornAvailable = Boolean(roverId && pipelineHorn);
  const hornBlocked = horn?.overheated;
  const cameraMin = typeof cameraConfig?.minAngle === 'number' ? cameraConfig.minAngle : -45;
  const cameraMax = typeof cameraConfig?.maxAngle === 'number' ? cameraConfig.maxAngle : 45;
  const cameraValue =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof cameraConfig?.homeAngle === 'number'
        ? cameraConfig.homeAngle
        : (cameraMin + cameraMax) / 2;
  const cameraDisabled = Boolean(controlsDisabled || dockAssist.cameraLocked);
  /*
    The mobile tilt track shares the same precision flag as desktop tilt. This
    keeps the servo fine-step behavior tied to the selected movement mode rather
    than inventing a separate mobile-only camera setting.
  */
  const cameraTiltStep = camera?.precisionMode
    ? CAMERA_TILT_PRECISION_STEP_DEGREES
    : CAMERA_TILT_STEP_DEGREES;

  const handleHeadlightToggle = useCallback(
    (nextOn) => {
      if (!headlightAvailable || controlsDisabled) return;
      setHeadlight(nextOn);
    },
    [controlsDisabled, headlightAvailable, setHeadlight],
  );

  const handleLaserToggle = useCallback(
    (nextOn) => {
      if (!laserAvailable || controlsDisabled) return;
      setLaser(nextOn);
    },
    [controlsDisabled, laserAvailable, setLaser],
  );

  const handleHornStart = useCallback(() => {
    if (controlsDisabled) return false;
    return startHorn();
  }, [controlsDisabled, startHorn]);

  const handleAuxPress = useCallback(
    (id, values) => {
      if (vacuumDisabled) return;
      activeAuxButtonRef.current = id;
      setAuxMotors(values);
    },
    [setAuxMotors, vacuumDisabled],
  );

  const handleAuxRelease = useCallback(
    (id) => {
      if (activeAuxButtonRef.current === id) {
        activeAuxButtonRef.current = null;
        // Neutral commands must remain available after ownership or OI state is
        // lost; otherwise disabling a held control could preserve its last output.
        setAuxMotors(AUX_ZERO);
      }
    },
    [setAuxMotors],
  );

  useEffect(() => {
    if (!vacuumDisabled || activeAuxButtonRef.current === null) return;
    // Pointer cancellation is browser-dependent when a held button becomes
    // disabled. Explicitly neutralize the Roomba motors at the state boundary.
    activeAuxButtonRef.current = null;
    setAuxMotors(AUX_ZERO);
  }, [setAuxMotors, vacuumDisabled]);

  return (
    <div className="mobile-touch-control grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-0.5 text-slate-100">
      <VacuumControls
        disabled={vacuumDisabled}
        onPress={handleAuxPress}
        onRelease={handleAuxRelease}
      />
      <div className="mobile-touch-control flex min-h-0 items-stretch gap-0.5">
        {cameraEnabled ? (
          <VerticalCameraTilt
            value={cameraValue}
            min={cameraMin}
            max={cameraMax}
            step={cameraTiltStep}
            disabled={cameraDisabled}
            onChange={setServoAngle}
          />
        ) : null}
        {(headlightAvailable || laserAvailable) ? (
          <div className="mobile-touch-control flex min-h-0 flex-1 flex-col gap-0.5">
            {headlightAvailable ? (
              <GPIOToggleControl
                label="Headlight"
                icon={FaLightbulb}
                on={headlightState?.headlightOn}
                disabled={controlsDisabled}
                onToggle={handleHeadlightToggle}
                heightClass="h-full"
              />
            ) : null}
            {laserAvailable ? (
              <GPIOToggleControl
                label="Laser"
                icon={FaCrosshairs}
                on={laserState?.laserOn}
                disabled={controlsDisabled || roomLightsLockedOn}
                onToggle={handleLaserToggle}
                heightClass="h-full"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mobile-touch-control min-h-0">
        {hornAvailable ? (
          <HornControl
            icon={FaBullhorn}
            disabled={controlsDisabled || hornBlocked}
            onStart={handleHornStart}
            onStop={stopHorn}
            active={horn?.active}
            heat={horn?.heat}
            defaultShowSettings={false}
            showSettingsToggle
            compactSettings
            className="h-full"
          />
        ) : null}
      </div>
    </div>
  );
}

export default function AuxColumn({ layout, className = '' }) {
  return (
    <div className={`mobile-touch-control flex flex-col gap-0.5 ${className}`.trim()} data-mobile-layout={layout}>
      <AuxColumnContent />
    </div>
  );
}
