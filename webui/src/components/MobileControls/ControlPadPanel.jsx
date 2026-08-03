// Control Pad Panel
// Purpose: Provides the mobile movement control pad and speed mode selector.
// Scope: Converts touch pad cells into keyboard-style drive vectors; movement column owns drive/dock placement.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './mobileControls.css';
import { useControlActions, useControlSelector } from '../../controls/index.js';
import { normalizeKeymapEntries } from '../../controls/keymapUtils.js';
import {
  computeKeyboardDriveVector,
  getKeyboardDriveSpeedOptions,
  resolveKeyboardSpeeds,
} from '../../controls/inputs/driveIntent.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { INPUT_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';
import FloatingJoystick from './FloatingJoystick.jsx';
import {
  DRIVE_PAD_REPEAT_MS,
  DRIVE_PAD_SPEED_MODES,
  SOURCE,
} from './constants.js';

function firstTokenForAction(keymap, actionId) {
  const bindingSet = keymap?.[actionId];
  if (!bindingSet || bindingSet.size === 0) return null;
  return bindingSet.values().next().value ?? null;
}

function getSpeedModeConfig(speedMode) {
  return DRIVE_PAD_SPEED_MODES.find((mode) => mode.id === speedMode) || DRIVE_PAD_SPEED_MODES[1];
}

export default function ControlPadPanel({ compact = false, disabled = false }) {
  const rawKeymap = useControlSelector((control) => control.state.keymap);
  const { setCameraPrecisionMode, setDriveVector, registerInputState } = useControlActions();
  const { value: inputSettings } = useSettingsNamespace('inputs', INPUT_SETTINGS_DEFAULTS);
  const [speedMode, setSpeedMode] = useState('normal');
  const [activeInputLabel, setActiveInputLabel] = useState('stop');
  const speedModeRef = useRef('normal');
  const activeCellRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const keymap = useMemo(() => normalizeKeymapEntries(rawKeymap), [rawKeymap]);
  const keyboardSpeeds = useMemo(() => resolveKeyboardSpeeds(inputSettings), [inputSettings]);

  const clearRepeatTimer = useCallback(() => {
    if (!repeatTimerRef.current) return;
    clearInterval(repeatTimerRef.current);
    repeatTimerRef.current = null;
  }, []);

  const buildVirtualKeyTokens = useCallback(
    (cell, modeId = speedModeRef.current) => {
      const tokens = new Set();
      const speedModeConfig = getSpeedModeConfig(modeId);
      const actionIds = [
        ...(Array.isArray(cell?.actions) ? cell.actions : []),
        speedModeConfig.modifierAction,
      ].filter(Boolean);

      actionIds.forEach((actionId) => {
        const token = firstTokenForAction(keymap, actionId);
        if (token) tokens.add(token);
      });

      return tokens;
    },
    [keymap],
  );

  const sendDriveCell = useCallback(
    (cell, lastEvent = 'move', modeId = speedModeRef.current) => {
      if (disabled) return;
      const tokens = buildVirtualKeyTokens(cell, modeId);
      const vector = computeKeyboardDriveVector(tokens, keymap);
      const speedOptions = getKeyboardDriveSpeedOptions(tokens, keymap, keyboardSpeeds);
      const precisionActive = modeId === 'precision';

      // Mobile deliberately routes through the keyboard vector/speed helpers. The
      // thumb pad only chooses which virtual keys are down, so changes to keyboard
      // drive behavior automatically stay matched here.
      /*
        The selected mobile speed mode is persistent, unlike the keyboard's held
        Shift modifier. Publishing camera precision here makes the servo tilt
        controls follow the mobile movement mode even before the driver starts
        dragging on the pad.
      */
      setCameraPrecisionMode(precisionActive);
      setDriveVector(vector, { source: SOURCE, speedOptions });
      registerInputState(SOURCE, {
        keys: Array.from(tokens),
        vector,
        activeCell: cell?.id ?? 'stop',
        speedMode: modeId,
        lastEvent,
      });
    },
    [
      buildVirtualKeyTokens,
      disabled,
      keyboardSpeeds,
      keymap,
      registerInputState,
      setCameraPrecisionMode,
      setDriveVector,
    ],
  );

  const stopDrivePad = useCallback(
    (lastEvent = 'stop') => {
      clearRepeatTimer();
      activeCellRef.current = null;
      setActiveInputLabel('stop');
      sendDriveCell({ id: 'stop', actions: [] }, lastEvent, speedModeRef.current);
    },
    [clearRepeatTimer, sendDriveCell],
  );

  const startRepeatTimer = useCallback(() => {
    if (repeatTimerRef.current) return;
    repeatTimerRef.current = setInterval(() => {
      if (!activeCellRef.current) return;
      sendDriveCell(activeCellRef.current, 'repeat');
    }, DRIVE_PAD_REPEAT_MS);
  }, [sendDriveCell]);

  const handleCellChange = useCallback(
    (cell) => {
      if (disabled) return;
      activeCellRef.current = cell;
      setActiveInputLabel(cell?.label || 'stop');
      sendDriveCell(cell, 'move');
      startRepeatTimer();
    },
    [disabled, sendDriveCell, startRepeatTimer],
  );

  const handleSpeedModeChange = useCallback(
    (nextMode) => {
      if (nextMode === speedModeRef.current) return;
      setSpeedMode(nextMode);
      speedModeRef.current = nextMode;
      // Confirm the accepted mode transition here so tapping an already-active
      // mode cannot produce feedback for a state change that did not happen.
      triggerTouchHaptic('button');
      setCameraPrecisionMode(nextMode === 'precision');
      if (activeCellRef.current) {
        sendDriveCell(activeCellRef.current, 'speed', nextMode);
      }
    },
    [sendDriveCell, setCameraPrecisionMode],
  );

  useEffect(() => {
    return () => {
      clearRepeatTimer();
      /*
        Mobile controls can unmount during an orientation/layout change while a
        pointer is still captured by the disappearing element. Publish a neutral
        vector directly during cleanup so neither rover drive nor PTZ pan/tilt
        can retain the last cell merely because pointerup had nowhere to land.
      */
      activeCellRef.current = null;
      setDriveVector({ x: 0, y: 0, boost: false }, { source: SOURCE });
      registerInputState(SOURCE, {
        keys: [],
        vector: { x: 0, y: 0, boost: false },
        activeCell: 'stop',
        speedMode: speedModeRef.current,
        lastEvent: 'unmount',
      });
      // Clear the shared flag too, so a stale mobile precision choice cannot
      // leave desktop/keyboard camera tilt in fine-step mode.
      setCameraPrecisionMode(false);
    };
  }, [clearRepeatTimer, registerInputState, setCameraPrecisionMode, setDriveVector]);

  useEffect(() => {
    if (!disabled) return;
    stopDrivePad('disabled');
    setCameraPrecisionMode(false);
  }, [disabled, setCameraPrecisionMode, stopDrivePad]);

  return (
    <div className={`mobile-touch-control flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border-2 border-slate-700 bg-slate-900 text-slate-100 shadow-md ${compact ? 'h-full' : ''}`}>
      <div className={`mobile-touch-control grid grid-cols-3 gap-0.5 border-b border-slate-700 bg-slate-950 ${compact ? 'p-0.25' : 'p-0.5'}`}>
        {DRIVE_PAD_SPEED_MODES.map((mode) => {
          const active = speedMode === mode.id;
          const speedValue =
            mode.id === 'precision'
              ? keyboardSpeeds.precisionSpeed
              : mode.id === 'turbo'
                ? keyboardSpeeds.turboSpeed
                : keyboardSpeeds.baseSpeed;
          return (
            <button
              key={mode.id}
              type="button"
              className={`mobile-touch-control rounded-md px-1 text-xs font-semibold ${compact ? 'min-h-7' : 'min-h-9'} ${
                active
                  ? 'bg-cyan-300 text-slate-950'
                  : 'bg-slate-800 text-slate-200'
              }`}
              onClick={() => handleSpeedModeChange(mode.id)}
              disabled={disabled}
            >
              <span className="block leading-tight">{mode.label}</span>
              {!compact ? <span className="block font-mono text-[0.7rem] leading-tight">{speedValue}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mobile-touch-control min-h-0 flex-1">
        <FloatingJoystick
          activeInputLabel={activeInputLabel}
          compact={compact}
          disabled={disabled}
          onCellChange={handleCellChange}
          onStop={() => stopDrivePad('stop')}
        />
      </div>
    </div>
  );
}
