import { useMemo, useState, useEffect, useCallback } from 'react';
import { useControlSystem } from '../controls/index.js';
import { DEFAULT_KEYMAP } from '../controls/constants.js';
import { canonicalizeKeyInput, formatKeyLabel } from '../controls/keymapUtils.js';
import { useSettingsNamespace } from '../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

const KEY_ACTIONS = [
  { id: 'driveForward', label: 'Drive Forward', group: 'Driving' },
  { id: 'driveBackward', label: 'Drive Backward', group: 'Driving' },
  { id: 'driveLeft', label: 'Turn Left', group: 'Driving' },
  { id: 'driveRight', label: 'Turn Right', group: 'Driving' },
  { id: 'boostModifier', label: 'Boost Modifier', group: 'Driving' },
  { id: 'slowModifier', label: 'Slow Modifier', group: 'Driving' },
  { id: 'auxMainForward', label: 'Main Brush Forward', group: 'Aux Motors' },
  { id: 'auxMainReverse', label: 'Main Brush Reverse', group: 'Aux Motors' },
  { id: 'auxSideForward', label: 'Side Brush Forward', group: 'Aux Motors' },
  { id: 'auxSideReverse', label: 'Side Brush Reverse', group: 'Aux Motors' },
  { id: 'auxVacuumFast', label: 'Vacuum Max', group: 'Aux Motors' },
  { id: 'auxVacuumSlow', label: 'Vacuum Low', group: 'Aux Motors' },
  { id: 'auxAllForward', label: 'All Aux Forward', group: 'Aux Motors' },
  { id: 'cameraUp', label: 'Camera Up', group: 'Camera' },
  { id: 'cameraDown', label: 'Camera Down', group: 'Camera' },
  { id: 'nightVisionToggle', label: 'Toggle Night Vision', group: 'Camera' },
  { id: 'driveMacro', label: 'Drive Macro', group: 'Macros' },
  { id: 'dockMacro', label: 'Dock Macro', group: 'Macros' },
  { id: 'chatFocus', label: 'Toggle Chat', group: 'Chat' },
  { id: 'songNoteUp', label: 'Song Note Up', group: 'Audio' },
  { id: 'songNoteDown', label: 'Song Note Down', group: 'Audio' },
];

function groupActions(actions) {
  return actions.reduce((acc, action) => {
    const list = acc[action.group] || (acc[action.group] = []);
    list.push(action);
    return acc;
  }, {});
}

function clampSpeed(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(500, num));
}

const TILT_INTERVAL_MIN = 5;
const TILT_INTERVAL_MAX = 500;
const TILT_SPEED_MIN = 1;
const TILT_SPEED_MAX = 100;

function clampTiltInterval(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(TILT_INTERVAL_MIN, Math.min(TILT_INTERVAL_MAX, num));
}

function clampTiltSpeed(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(TILT_SPEED_MIN, Math.min(TILT_SPEED_MAX, num));
}

function mapTiltSpeedToInterval(speed) {
  const clampedSpeed = clampTiltSpeed(speed, speed);
  const ratio = (clampedSpeed - TILT_SPEED_MIN) / (TILT_SPEED_MAX - TILT_SPEED_MIN);
  const interval = TILT_INTERVAL_MAX - ratio * (TILT_INTERVAL_MAX - TILT_INTERVAL_MIN);
  return Math.round(interval);
}

function mapTiltIntervalToSpeed(interval) {
  const clampedInterval = clampTiltInterval(interval, interval);
  const ratio = (TILT_INTERVAL_MAX - clampedInterval) / (TILT_INTERVAL_MAX - TILT_INTERVAL_MIN);
  const speed = TILT_SPEED_MIN + ratio * (TILT_SPEED_MAX - TILT_SPEED_MIN);
  return Math.round(speed);
}

function useKeyCapture(onCapture) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    function handle(event) {
      event.preventDefault();
      if (event.key === 'Escape') {
        setActive(null);
        return;
      }
      const canonical = canonicalizeKeyInput(event.key ?? '');
      if (canonical) {
        onCapture(active, canonical, event);
        setActive(null);
      }
    }
    window.addEventListener('keydown', handle, { capture: true });
    return () => window.removeEventListener('keydown', handle, { capture: true });
  }, [active, onCapture]);

  return { active, startCapture: setActive, cancel: () => setActive(null) };
}

function SpeedField({ label, description, value, onChange, min = 0, max = 500, step = 5 }) {
  return (
    <label className="surface-muted block p-0.5">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span className="font-semibold text-slate-100">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-16 rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-right text-[0.75rem] font-mono text-slate-100"
        />
      </div>
      {description && <p className="text-[0.65rem] text-slate-500">{description}</p>}
      <div className="mt-0.5 flex items-center gap-0.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-2 flex-1 accent-emerald-400"
        />
        <span className="w-12 text-right text-[0.75rem] font-mono text-slate-400">{value}</span>
      </div>
    </label>
  );
}

export default function KeymapSettings() {
  const {
    state: { keymap },
    actions: { updateKeyBinding, resetKeyBindings },
  } = useControlSystem();
  const { value: inputSettings, save: saveInputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const keyboardSettings = {
    ...INPUT_SETTINGS_DEFAULTS.keyboard,
    ...(inputSettings.keyboard ?? {}),
  };
  const tiltSpeed = useMemo(() => {
    if (typeof keyboardSettings.tiltSpeed === 'number') {
      return clampTiltSpeed(keyboardSettings.tiltSpeed, INPUT_SETTINGS_DEFAULTS.keyboard.tiltSpeed);
    }
    if (typeof keyboardSettings.tiltIntervalMs === 'number') {
      return clampTiltSpeed(
        mapTiltIntervalToSpeed(keyboardSettings.tiltIntervalMs),
        INPUT_SETTINGS_DEFAULTS.keyboard.tiltSpeed,
      );
    }
    return INPUT_SETTINGS_DEFAULTS.keyboard.tiltSpeed;
  }, [keyboardSettings.tiltIntervalMs, keyboardSettings.tiltSpeed]);
  const grouped = useMemo(() => groupActions(KEY_ACTIONS), []);
  const { active, startCapture, cancel } = useKeyCapture((actionId, value) => {
    updateKeyBinding(actionId, value);
  });

  const currentKey = useCallback(
    (id) => keymap?.[id]?.[0] || DEFAULT_KEYMAP[id]?.[0] || '',
    [keymap],
  );

  const updateKeyboardSpeed = useCallback(
    (key, nextValue) => {
      const defaults = INPUT_SETTINGS_DEFAULTS.keyboard;
      const clamped = clampSpeed(nextValue, defaults[key]);
      saveInputSettings((prev) => ({
        ...(prev ?? {}),
        keyboard: {
          ...(prev?.keyboard ?? defaults),
          [key]: clamped,
        },
      }));
    },
    [saveInputSettings],
  );

  const updateTiltInterval = useCallback(
    (nextValue) => {
      const defaults = INPUT_SETTINGS_DEFAULTS.keyboard;
      const clamped = clampTiltSpeed(nextValue, defaults.tiltSpeed);
      const mappedInterval = mapTiltSpeedToInterval(clamped);
      saveInputSettings((prev) => ({
        ...(prev ?? {}),
        keyboard: {
          ...(prev?.keyboard ?? defaults),
          tiltSpeed: clamped,
          tiltIntervalMs: mappedInterval,
        },
      }));
    },
    [saveInputSettings],
  );

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Keyboard layout</p>
          <p className="text-[0.7rem] text-slate-500">Per-browser · click to change a binding</p>
        </div>
        <button type="button" onClick={() => resetKeyBindings()} className="button-dark text-xs">
          Reset defaults
        </button>
      </div>
      <div className="space-y-0.5 surface">
        <p className="text-[0.7rem] text-slate-500">Keyboard speeds</p>
        <div className="space-y-0.5">
          <SpeedField
            label="Base speed"
            description="Normal driving speed"
            value={keyboardSettings.baseSpeed}
            onChange={(value) => updateKeyboardSpeed('baseSpeed', value)}
          />
          <SpeedField
            label="Turbo speed"
            description="Used when holding the boost modifier"
            value={keyboardSettings.turboSpeed}
            onChange={(value) => updateKeyboardSpeed('turboSpeed', value)}
          />
          <SpeedField
            label="Precision speed"
            description="Used when holding the precision modifier"
            value={keyboardSettings.precisionSpeed}
            onChange={(value) => updateKeyboardSpeed('precisionSpeed', value)}
          />
        </div>
      </div>
      <div className="space-y-0.5 surface">
        <p className="text-[0.7rem] text-slate-500">Camera tilt</p>
        <SpeedField
          label="Tilt speed"
          description="Higher = faster when holding tilt keys"
          value={tiltSpeed}
          onChange={updateTiltInterval}
          min={1}
          max={100}
          step={1}
        />
      </div>
      <div className="space-y-0.5">
        {Object.entries(grouped).map(([group, actions]) => (
          <div key={group} className="space-y-0.5 surface">
            <p className="text-[0.75rem] text-slate-400">{group}</p>
            <div className="space-y-0.5">
              {actions.map((action) => {
                const value = currentKey(action.id);
                const isActive = active === action.id;
                return (
                  <div key={action.id} className="surface-muted flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-slate-100">{action.label}</p>
                      <p className="text-[0.65rem] text-slate-400">{formatKeyLabel(value)}</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {isActive && (
                        <button type="button" onClick={() => cancel()} className="button-danger text-[0.7rem]">
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startCapture(action.id)}
                        className={`${isActive ? 'px-0.5 py-0.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400' : 'button-dark'} text-[0.7rem] font-medium transition-colors`}
                      >
                        {isActive ? 'Press a key…' : 'Change'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
