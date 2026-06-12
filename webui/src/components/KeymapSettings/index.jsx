// Keymap Settings
// Purpose: Defines the Keymap Settings module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { DEFAULT_KEYMAP } from '../../controls/constants.js';
import { canonicalizeKeyInput, formatKeyLabel } from '../../controls/keymapUtils.js';
import { setKeyboardCaptureLocked } from '../../controls/inputs/keyboardCaptureLock.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import CardFrame from '../CardFrame/index.jsx';

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
  { id: 'videoFilterCycle', label: 'Cycle Video Filter', group: 'Camera' },
  { id: 'hornHonk', label: 'Horn (Hold)', group: 'Audio' },
  { id: 'micPtt', label: 'Mic Push To Talk', group: 'Audio' },
  { id: 'driveMacro', label: 'Drive Macro', group: 'Macros' },
  { id: 'dockMacro', label: 'Dock Macro', group: 'Macros' },
  { id: 'chatFocus', label: 'Toggle Chat', group: 'Chat' },
  { id: 'songNoteUp', label: 'Song Note Up', group: 'Audio' },
  { id: 'songNoteDown', label: 'Song Note Down', group: 'Audio' },
  { id: 'homeAssistantOn', label: 'Room Controls On (Cycle)', group: 'Room Controls' },
  { id: 'homeAssistantOff', label: 'Room Controls Off (Cycle)', group: 'Room Controls' },
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

  const startCapture = useCallback((actionId) => {
    setKeyboardCaptureLocked(true);
    setActive(actionId);
  }, []);

  const cancel = useCallback(() => {
    setKeyboardCaptureLocked(false);
    setActive(null);
  }, []);

  const captureFromEvent = useCallback(
    (actionId, event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        cancel();
        return;
      }
      const canonical = canonicalizeKeyInput(event.key ?? '');
      if (!canonical) return;
      onCapture(actionId, canonical, event);
      cancel();
    },
    [cancel, onCapture],
  );

  useEffect(() => () => setKeyboardCaptureLocked(false), []);

  return { active, startCapture, cancel, captureFromEvent };
}

function SettingsGroupLabel({ children }) {
  // Group labels stay at the app's normal small-panel scale, but use white text so they are
  // readable without resorting to oversized type or all-caps styling.
  return <p className="mx-auto w-full max-w-lg text-sm font-semibold text-white">{children}</p>;
}

function SpeedField({ label, description, value, onChange, min = 0, max = 500, step = 5 }) {
  return (
    <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
      {/* The value field sits beside the label because users tune these settings by comparing
          the name and the numeric value together. Keeping them in one row prevents the number
          input from drifting across a wide settings panel. */}
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-start gap-1.5 text-sm text-white">
        <span className="min-w-0 font-semibold text-white">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-right text-xs font-mono text-white"
        />
      </div>
      {description && <p className="mt-0.5 text-xs leading-snug text-white">{description}</p>}
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-2 min-w-0 flex-1 accent-emerald-400"
        />
        <span className="w-10 text-right text-xs font-mono text-white">{value}</span>
      </div>
    </label>
  );
}

function BindingRow({ action, value, isActive, onCaptureStart, onCancel, onCaptureKeyDown }) {
  // Binding rows are intentionally constrained and boxed: the action name, current key, and
  // change button are one interaction unit, so proximity matters more than stretching to fill
  // every available pixel in the surrounding sidebar.
  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm max-[420px]:grid-cols-1">
      <div className="min-w-0">
        <p className="font-semibold leading-snug text-white">{action.label}</p>
        <p className="mt-0.5 text-xs leading-snug text-white">{formatKeyLabel(value)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 max-[420px]:justify-start">
        {/* The cancel button only appears during capture so the normal row stays compact, while
            the active row still gives users an obvious way out if they clicked Change by mistake. */}
        {isActive && (
          <button type="button" onClick={onCancel} className="button-danger px-1 py-0.5 text-xs">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onCaptureStart}
          onKeyDown={isActive ? onCaptureKeyDown : undefined}
          autoFocus={isActive}
          className={`${isActive ? 'rounded-md bg-emerald-500 px-1 py-0.5 text-emerald-950 hover:bg-emerald-400' : 'button-dark px-1 py-0.5'} text-xs font-medium transition-colors`}
        >
          {isActive ? 'Press a key...' : 'Change'}
        </button>
      </div>
    </div>
  );
}

export default function KeymapSettings() {
  const keymap = useControlSelector((control) => control.state.keymap);
  const { updateKeyBinding, resetKeyBindings } = useControlActions();
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
  const { active, startCapture, cancel, captureFromEvent } = useKeyCapture((actionId, value) => {
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
    <CardFrame
      title="Keyboard layout"
      meta="Per-browser · click to change a binding"
      actions={
        <button type="button" onClick={() => resetKeyBindings()} className="button-dark px-1 py-0.5 text-xs">
          Reset defaults
        </button>
      }
      bodyClassName="space-y-2 p-1 text-sm"
    >
      <div className="space-y-1">
        <SettingsGroupLabel>Keyboard speeds</SettingsGroupLabel>
        {/* Speed controls remain stacked instead of becoming two columns because each slider
            needs enough width for fine adjustment and a nearby number input. */}
        <div className="grid gap-1">
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
      <div className="space-y-1">
        <SettingsGroupLabel>Camera tilt</SettingsGroupLabel>
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
      <div className="space-y-2">
        {Object.entries(grouped).map(([group, actions]) => (
          <div key={group} className="space-y-1">
            <SettingsGroupLabel>{group}</SettingsGroupLabel>
            <div className="grid gap-1">
              {actions.map((action) => {
                const value = currentKey(action.id);
                const isActive = active === action.id;
                // Each action keeps the same capture behavior as before; only the row chrome
                // changes so the current binding and Change button stay visually connected.
                return (
                  <BindingRow
                    key={action.id}
                    action={action}
                    value={value}
                    isActive={isActive}
                    onCancel={() => cancel()}
                    onCaptureStart={() => startCapture(action.id)}
                    onCaptureKeyDown={(event) => captureFromEvent(action.id, event)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
