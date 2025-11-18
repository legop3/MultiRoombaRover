import { useSettingsNamespace } from '../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function SliderField({ label, description, min, max, step, value, onChange }) {
  return (
    <label className="block rounded border border-white/5 p-1">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span className="font-semibold text-slate-100">{label}</span>
        <span className="font-mono text-slate-400">{NUMBER_FORMAT.format(value)}</span>
      </div>
      {description && <p className="text-[0.65rem] text-slate-500">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-emerald-400"
      />
    </label>
  );
}

export default function InputSettings() {
  const { value, save } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const gamepad = value.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad;
  const mobile = value.mobile ?? INPUT_SETTINGS_DEFAULTS.mobile;

  const updateGamepad = (patch) => {
    save((prev) => ({
      ...prev,
      gamepad: { ...(prev.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad), ...patch },
    }));
  };

  const updateMobile = (patch) => {
    save((prev) => ({
      ...prev,
      mobile: { ...(prev.mobile ?? INPUT_SETTINGS_DEFAULTS.mobile), ...patch },
    }));
  };

  return (
    <section className="rounded-sm bg-[#1d232b] p-1 text-sm text-slate-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Input tuning</p>
      <div className="mt-2 space-y-2">
        <div>
          <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">Gamepad</p>
          <div className="mt-1 space-y-1">
            <SliderField
              label="Drive deadzone"
              description="Ignore small stick movements"
              min={0}
              max={0.5}
              step={0.01}
              value={gamepad.driveDeadzone}
              onChange={(driveDeadzone) => updateGamepad({ driveDeadzone })}
            />
            <SliderField
              label="Camera deadzone"
              description="Tilt stick sensitivity"
              min={0}
              max={0.5}
              step={0.01}
              value={gamepad.cameraDeadzone}
              onChange={(cameraDeadzone) => updateGamepad({ cameraDeadzone })}
            />
            <SliderField
              label="Servo step"
              description="Degrees per camera tick"
              min={0.5}
              max={6}
              step={0.25}
              value={gamepad.servoStep}
              onChange={(servoStep) => updateGamepad({ servoStep })}
            />
          </div>
        </div>
        <div>
          <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">Mobile joystick</p>
          <div className="mt-1 space-y-1">
            <SliderField
              label="Joystick radius"
              description="Drag distance needed for full speed"
              min={50}
              max={140}
              step={5}
              value={mobile.joystickRadius}
              onChange={(joystickRadius) => updateMobile({ joystickRadius })}
            />
            <SliderField
              label="Smoothing"
              description="Lower values feel more direct"
              min={0}
              max={0.6}
              step={0.02}
              value={mobile.joystickSmoothing}
              onChange={(joystickSmoothing) => updateMobile({ joystickSmoothing })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
