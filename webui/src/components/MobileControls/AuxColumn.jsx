// Aux Column
// Purpose: Assembles the mobile auxiliary controls column, which is the left column by default.
// Scope: Owns mobile aux/camera/headlight/laser/horn wiring while reusing desktop variation components where intended.
import { useCallback, useRef } from 'react';
import './mobileControls.css';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
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
  const disabled = !roverId;
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
  const cameraDisabled = Boolean(disabled || dockAssist.cameraLocked);
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
      if (!headlightAvailable) return;
      setHeadlight(nextOn);
    },
    [headlightAvailable, setHeadlight],
  );

  const handleLaserToggle = useCallback(
    (nextOn) => {
      if (!laserAvailable) return;
      setLaser(nextOn);
    },
    [laserAvailable, setLaser],
  );

  const handleHornStart = useCallback(() => {
    return startHorn();
  }, [startHorn]);

  const handleAuxPress = useCallback(
    (id, values) => {
      if (disabled) return;
      activeAuxButtonRef.current = id;
      setAuxMotors(values);
    },
    [disabled, setAuxMotors],
  );

  const handleAuxRelease = useCallback(
    (id) => {
      if (disabled) return;
      if (activeAuxButtonRef.current === id) {
        activeAuxButtonRef.current = null;
        setAuxMotors(AUX_ZERO);
      }
    },
    [disabled, setAuxMotors],
  );

  return (
    <div className="mobile-touch-control grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-0.5 text-slate-100">
      <VacuumControls
        disabled={disabled}
        onPress={handleAuxPress}
        onRelease={handleAuxRelease}
      />
      <div className="mobile-touch-control flex min-h-0 items-stretch gap-0.5">
        {cameraEnabled ? (
          // Match the desktop camera tilt card's emerald styling so the vertical
          // mobile control reads as the same feature in a phone-sized layout.
          <div className="mobile-touch-control flex-1 min-h-0 rounded-xl border-2 border-emerald-300/70 bg-emerald-900 px-1 py-1 text-emerald-50">
            <VerticalCameraTilt
              value={cameraValue}
              min={cameraMin}
              max={cameraMax}
              step={cameraTiltStep}
              disabled={cameraDisabled}
              onChange={setServoAngle}
            />
          </div>
        ) : null}
        {(headlightAvailable || laserAvailable) ? (
          <div className="mobile-touch-control flex min-h-0 flex-1 flex-col gap-0.5">
            {headlightAvailable ? (
              <GPIOToggleControl
                label="Headlight"
                on={headlightState?.headlightOn}
                disabled={disabled}
                onToggle={handleHeadlightToggle}
                heightClass="h-full"
              />
            ) : null}
            {laserAvailable ? (
              <GPIOToggleControl
                label="Laser"
                on={laserState?.laserOn}
                disabled={disabled || roomLightsLockedOn}
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
            disabled={disabled || hornBlocked}
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
