// Aux Column
// Purpose: Assembles the mobile auxiliary controls column, which is the left column by default.
// Scope: Owns mobile aux/camera/night vision/horn wiring while reusing desktop variation components where intended.
import { useCallback, useRef } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { useManualDockAssist } from '../../features/manualDockAssist/useManualDockAssist.js';
import HornControl from '../HornControl/index.jsx';
import NightVisionControl from '../NightVisionControl/index.jsx';
import { AUX_ZERO } from './constants.js';
import VacuumControls from './VacuumControls.jsx';
import VerticalCameraTilt from './VerticalCameraTilt.jsx';

function AuxColumnContent() {
  const roverId = useControlSelector((control) => control.state.roverId);
  const camera = useControlSelector((control) => control.state.camera);
  const horn = useControlSelector((control) => control.state.horn);
  const nightVision = useControlSelector((control) => control.pipeline?.nightVision);
  const nightVisionState = useControlSelector((control) => control.pipeline?.nightVisionState);
  const pipelineHorn = useControlSelector((control) => control.pipeline?.horn);
  const { setServoAngle, setNightVision, setAuxMotors, startHorn, stopHorn } = useControlActions();
  const dockAssist = useManualDockAssist();
  const disabled = !roverId;
  const activeAuxButtonRef = useRef(null);
  const cameraConfig = camera?.config;
  const cameraEnabled = Boolean(roverId && camera?.enabled && cameraConfig);
  const nightVisionAvailable = Boolean(roverId && nightVision);
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

  const handleNightVisionToggle = useCallback(
    (nextOn) => {
      if (!nightVisionAvailable) return;
      setNightVision(nextOn);
    },
    [nightVisionAvailable, setNightVision],
  );

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
              step={0.5}
              disabled={cameraDisabled}
              onChange={setServoAngle}
            />
          </div>
        ) : null}
        {nightVisionAvailable ? (
          <NightVisionControl
            nightVisionOn={nightVisionState?.nightVisionOn}
            disabled={disabled}
            onToggle={handleNightVisionToggle}
            heightClass="h-full"
          />
        ) : null}
      </div>
      <div className="mobile-touch-control min-h-0">
        {hornAvailable ? (
          <HornControl
            disabled={disabled || hornBlocked}
            onStart={startHorn}
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
