import { useControlSystem } from '../controls/index.js';
import { formatKeyLabel } from '../controls/keymapUtils.js';
import NightVisionControl from './NightVisionControl.jsx';
import HornControl from './HornControl.jsx';
import CameraTiltControl from './CameraTiltControl.jsx';

const SLIDER_THROTTLE_MS = 150;

export default function CameraServoPanel() {
  const {
    state: { roverId, camera, keymap, horn },
    pipeline,
    actions: { setServoAngle, setNightVision, startHorn, stopHorn },
  } = useControlSystem();
  const config = camera?.config;
  const enabled = Boolean(roverId && camera?.enabled && config);
  const nightVisionAvailable = Boolean(roverId && pipeline?.nightVision);
  const nightVisionState = pipeline?.nightVisionState;
  const hornAvailable = Boolean(roverId && pipeline?.horn);
  const nightVisionKey = formatKeyLabel(keymap?.nightVisionToggle?.[0]);
  const hornKey = formatKeyLabel(keymap?.hornHonk?.[0]);
  const hornBlocked = horn?.overheated;
  const min = typeof config?.minAngle === 'number' ? config.minAngle : -30;
  const max = typeof config?.maxAngle === 'number' ? config.maxAngle : 30;
  const value =
    typeof camera?.angle === 'number'
      ? camera.angle
      : typeof config?.homeAngle === 'number'
        ? config.homeAngle
        : (min + max) / 2;

  if (!enabled && !nightVisionAvailable && !hornAvailable) return null;

  const handleNightVisionToggle = (nextOn) => {
    if (!nightVisionAvailable) return;
    setNightVision(nextOn);
  };

  return (
    <section className="panel-section space-y-0.5 text-base">
      {nightVisionAvailable && (
        <NightVisionControl
          nightVisionOn={nightVisionState?.nightVisionOn}
          disabled={!roverId}
          onToggle={handleNightVisionToggle}
          keyLabel={nightVisionKey}
        />
      )}
      {hornAvailable && (
        <HornControl
          disabled={!roverId || hornBlocked}
          onStart={startHorn}
          onStop={stopHorn}
          keyLabel={hornKey}
          active={horn?.active}
          heat={horn?.heat}
        />
      )}
      {enabled && (
        <CameraTiltControl
          value={value}
          min={min}
          max={max}
          step={0.5}
          onChange={setServoAngle}
          throttleMs={SLIDER_THROTTLE_MS}
          className="space-y-0.5"
          labelRowClass="text-sm text-slate-300"
          valueClass="font-mono text-sm text-slate-100"
          sliderClass="w-full"
          accentClass="accent-emerald-400"
          endpointClass="text-xs text-slate-400"
          endpointLabelClass=""
        />
      )}
      {/* <div className="flex gap-0.5 text-sm">
        <button type="button" className="flex-1 button-dark" onClick={() => handleNudge(-1)}>
          Tilt Down
        </button>
        <button type="button" className="flex-1 button-dark" onClick={() => goServoHome()}>
          Center
        </button>
        <button type="button" className="flex-1 button-dark" onClick={() => handleNudge(1)}>
          Tilt Up
        </button>
      </div> */}
      {/* <p className="text-xs text-slate-400">
        Step: {formatDegrees(step)} · Pin GPIO {config?.pin}
      </p> */}
    </section>
  );
}
