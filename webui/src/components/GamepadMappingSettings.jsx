import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { GAMEPAD_MAPPING_DEFAULT, INPUT_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

function useGamepad() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function updateStatus() {
      const pads = navigator.getGamepads?.();
      setConnected(Boolean(pads && Array.from(pads).some(Boolean)));
    }
    updateStatus();
    window.addEventListener('gamepadconnected', updateStatus);
    window.addEventListener('gamepaddisconnected', updateStatus);
    const id = setInterval(updateStatus, 2000);
    return () => {
      window.removeEventListener('gamepadconnected', updateStatus);
      window.removeEventListener('gamepaddisconnected', updateStatus);
      clearInterval(id);
    };
  }, []);

  return connected;
}

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const ACTIONS = [
  { id: 'driveHorizontal', label: 'Drive horizontal', type: 'axis', section: 'Drive joystick', path: ['drive', 'horizontal'] },
  { id: 'driveVertical', label: 'Drive vertical', type: 'axis', section: 'Drive joystick', path: ['drive', 'vertical'] },
  { id: 'cameraVertical', label: 'Camera vertical', type: 'axis', section: 'Camera joystick', path: ['camera', 'vertical'] },
  { id: 'mainAxis', label: 'Main brush axis', type: 'axis', section: 'Brush analog', path: ['brushes', 'mainAxis'] },
  { id: 'sideAxis', label: 'Side brush axis', type: 'axis', section: 'Brush analog', path: ['brushes', 'sideAxis'] },
  { id: 'mainReverse', label: 'Toggle main reverse', type: 'button', section: 'Brush toggles', path: ['buttons', 'mainReverse'] },
  { id: 'sideReverse', label: 'Toggle side reverse', type: 'button', section: 'Brush toggles', path: ['buttons', 'sideReverse'] },
  { id: 'vacuum', label: 'Vacuum button', type: 'button', section: 'Auxiliary buttons', path: ['buttons', 'vacuum'] },
  { id: 'allAux', label: 'All aux button', type: 'button', section: 'Auxiliary buttons', path: ['buttons', 'allAux'] },
  { id: 'drive', label: 'Drive macro button', type: 'button', section: 'Mode buttons', path: ['buttons', 'drive'] },
  { id: 'dock', label: 'Dock macro button', type: 'button', section: 'Mode buttons', path: ['buttons', 'dock'] },
];

function SliderField({ label, description, min, max, step, value, onChange }) {
  return (
    <label className="surface block">
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
        className="mt-0.5 w-full accent-emerald-400"
      />
    </label>
  );
}

function formatAxis(value) {
  if (!value) return 'Unassigned';
  return `Axis ${value.index}${value.invert ? ' (invert)' : ''}`;
}

function formatButton(value) {
  if (!value) return 'Unassigned';
  return `Button ${value.index}`;
}

function updatePath(mapping, path, updater) {
  const [group, key] = path;
  const next = { ...(mapping ?? GAMEPAD_MAPPING_DEFAULT) };
  next[group] = { ...(next[group] ?? GAMEPAD_MAPPING_DEFAULT[group]) };
  next[group][key] = updater(next[group][key]);
  return next;
}

export default function GamepadMappingSettings() {
  const gamepadConnected = useGamepad();
  const { value: mapping, save, reset } = useSettingsNamespace('gamepadMapping', GAMEPAD_MAPPING_DEFAULT);
  const { value: inputSettings, save: saveInputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const gamepadTuning = inputSettings.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad;
  const [capture, setCapture] = useState(null);
  const axisBaselineRef = useRef(null);

  const updateTuning = (patch) => {
    saveInputSettings((prev) => ({
      ...prev,
      gamepad: { ...(prev.gamepad ?? INPUT_SETTINGS_DEFAULTS.gamepad), ...patch },
    }));
  };

  useEffect(() => {
    axisBaselineRef.current = null;
  }, [capture]);

  useEffect(() => {
    if (!capture) return undefined;
    let raf;
    const scan = () => {
      const pads = navigator.getGamepads?.();
      const pad = pads && Array.from(pads).find(Boolean);
      if (pad) {
        if (capture.type === 'axis') {
          if (!axisBaselineRef.current) {
            axisBaselineRef.current = Array.from(pad.axes ?? []).map((value) => value ?? 0);
          }
          for (let i = 0; i < pad.axes.length; i += 1) {
            const value = pad.axes[i];
            const baseline = axisBaselineRef.current?.[i] ?? 0;
            const delta = Math.abs(value - baseline);
            if (Math.abs(value) > 0.65 && delta > 0.5) {
              save((prev) =>
                updatePath(prev, capture.path, () => ({
                  index: i,
                  invert: value < 0,
                })),
              );
              setCapture(null);
              return;
            }
          }
        } else if (capture.type === 'button') {
          for (let i = 0; i < pad.buttons.length; i += 1) {
            const btn = pad.buttons[i];
            if (btn && (btn.pressed || btn.value > 0.6)) {
              save((prev) => updatePath(prev, capture.path, () => ({ index: i })));
              setCapture(null);
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(scan);
    };
    raf = requestAnimationFrame(scan);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [capture, save]);

  const grouped = useMemo(() => {
    return ACTIONS.reduce((acc, action) => {
      const list = acc[action.section] || (acc[action.section] = []);
      list.push(action);
      return acc;
    }, {});
  }, []);

  const getStored = (action) => {
    const [group, key] = action.path;
    return mapping?.[group]?.[key] ?? null;
  };

  const getValueLabel = (action) => {
    const stored = getStored(action);
    return action.type === 'axis' ? formatAxis(stored) : formatButton(stored);
  };

  const handleClear = (action) => {
    save((prev) => updatePath(prev, action.path, () => null));
  };

  const handleInvert = (action) => {
    const stored = getStored(action);
    if (!stored) return;
    save((prev) =>
      updatePath(prev, action.path, (current) => ({
        ...current,
        invert: !current?.invert,
      })),
    );
  };

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Gamepad mapping</p>
          <p className="text-[0.65rem] text-slate-500">
            {gamepadConnected
              ? 'Move sticks/axes with a big sweep or press buttons when capturing.'
              : 'Connect a controller to configure.'}
          </p>
          {capture && (
            <p className="mt-0.5 text-[0.7rem] text-emerald-400">Capturing {capture.label}…</p>
          )}
        </div>
        <button type="button" onClick={() => reset()} className="button-dark text-xs">
          Clear all
        </button>
      </div>
      <div className="space-y-0.5">
        <div className="space-y-0.5 surface">
          <p className="text-[0.7rem] text-slate-500">Sensitivity &amp; feel</p>
          <div className="space-y-0.5">
            <SliderField
              label="Drive deadzone"
              description="Ignore small drive stick movement"
              min={0}
              max={0.6}
              step={0.01}
              value={gamepadTuning.driveDeadzone ?? 0.2}
              onChange={(driveDeadzone) => updateTuning({ driveDeadzone })}
            />
            <SliderField
              label="Camera deadzone"
              description="Tilt stick sensitivity"
              min={0}
              max={0.6}
              step={0.01}
              value={gamepadTuning.cameraDeadzone ?? 0.25}
              onChange={(cameraDeadzone) => updateTuning({ cameraDeadzone })}
            />
            <SliderField
              label="Servo step (deg)"
              description="Degrees per camera tick"
              min={0.5}
              max={6}
              step={0.25}
              value={gamepadTuning.servoStep ?? 2}
              onChange={(servoStep) => updateTuning({ servoStep })}
            />
            <SliderField
              label="Side reverse multiplier"
              description="Scale when reversing the side brush"
              min={0.3}
              max={1}
              step={0.05}
              value={gamepadTuning.auxReverseScale ?? 0.55}
              onChange={(auxReverseScale) => updateTuning({ auxReverseScale })}
            />
          </div>
        </div>
        {Object.entries(grouped).map(([section, actions]) => (
          <div key={section} className="space-y-0.5 surface">
            <p className="text-[0.7rem] text-slate-500">{section}</p>
            <div className="space-y-0.5">
              {actions.map((action) => (
                <div key={action.id} className="surface-muted flex items-center justify-between text-xs">
                  <div>
                    <p className="font-semibold text-slate-100">{action.label}</p>
                    <p className="text-[0.65rem] text-slate-400">{getValueLabel(action)}</p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {action.type === 'axis' && (
                      <button
                        type="button"
                        disabled={!getStored(action)}
                        onClick={() => handleInvert(action)}
                        className={`${
                          getStored(action)?.invert
                            ? 'px-0.5 py-0.5 bg-amber-400 text-amber-900 hover:bg-amber-300'
                            : 'button-dark'
                        } text-[0.7rem] font-medium disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        Invert
                      </button>
                    )}
                    <button type="button" onClick={() => handleClear(action)} className="button-dark text-[0.7rem]">
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setCapture(action)}
                      className={`${capture?.id === action.id ? 'px-0.5 py-0.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400' : 'button-dark'} text-[0.7rem] font-medium`}
                    >
                      {capture?.id === action.id ? 'Waiting…' : 'Capture'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
