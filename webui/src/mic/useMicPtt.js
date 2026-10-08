import { useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { DEFAULT_KEYMAP } from '../controls/constants.js';
import { formatKeyLabel, normalizeKeymapEntries, tokensForEvent } from '../controls/keymapUtils.js';
import { GAMEPAD_PROFILE_DEFAULT, GAMEPAD_SETTINGS_DEFAULTS } from '../settings/namespaces.js';
import { computeGamepadOutputs, resolveGamepadProfile } from '../controls/inputs/gamepadBindings.js';
import { subscribeGamepadHub } from '../controls/inputs/gamepadHub.js';
import { isTextInputElement, isTextEntryActive } from '../controls/inputs/inputFocusUtils.js';
import { isKeyboardCaptureLocked } from '../controls/inputs/keyboardCaptureLock.js';
import { isControllerControlLocked } from '../controls/inputs/controllerRuntime.js';

export default function useMicPtt(enabled) {
  const { value: controls } = useSettingsNamespace('controls', { keymap: DEFAULT_KEYMAP });
  const { value: gamepad } = useSettingsNamespace('gamepad', GAMEPAD_SETTINGS_DEFAULTS);
  const bindings = controls?.keymap?.micPtt ?? DEFAULT_KEYMAP.micPtt;
  const tokens = useMemo(() => normalizeKeymapEntries({ micPtt: bindings }).micPtt, [bindings]);
  const [keyboardHeld, setKeyboardHeld] = useState(false);
  const [controllerHeld, setControllerHeld] = useState(false);
  const [pointerHeld, setPointerHeld] = useState(false);
  const [buttonKeyHeld, setButtonKeyHeld] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const pressed = new Set();
    function reset() {
      pressed.clear();
      setKeyboardHeld(false);
      setControllerHeld(false);
      setPointerHeld(false);
      setButtonKeyHeld(false);
    }
    function keyDown(event) {
      if (isKeyboardCaptureLocked() || isTextInputElement(event.target)) return;
      const matching = tokensForEvent(event).filter((token) => tokens.has(token));
      if (!matching.length) return;
      event.preventDefault();
      matching.forEach((token) => pressed.add(token));
      setKeyboardHeld(true);
    }
    function keyUp(event) {
      tokensForEvent(event).forEach((token) => pressed.delete(token));
      setKeyboardHeld(pressed.size > 0);
    }
    function visibilityChange() {
      if (document.hidden) reset();
    }
    // Reuse the configured bindings and shared poller without mounting rover controls on /mic.
    const unsubscribe = subscribeGamepadHub(({ pads }) => {
      if (document.hidden || !document.hasFocus() || isTextEntryActive() || isControllerControlLocked()) {
        setControllerHeld(false);
        return;
      }
      const pad = pads.find((entry) => entry.instanceKey === gamepad?.activeInstanceKey) ?? pads[0];
      const profile = resolveGamepadProfile(
        gamepad?.profiles?.[pad?.signature] ?? gamepad?.defaults?.profile,
        GAMEPAD_PROFILE_DEFAULT,
      );
      setControllerHeld(Boolean(pad && computeGamepadOutputs(pad, profile).buttons.micPtt));
    });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibilityChange);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibilityChange);
      reset();
    };
  }, [enabled, tokens, gamepad]);

  return {
    held: enabled && (keyboardHeld || controllerHeld || pointerHeld || buttonKeyHeld),
    setPointerHeld,
    setButtonKeyHeld,
    keyLabel: (Array.isArray(bindings) ? bindings : [bindings]).map(formatKeyLabel).join(' / '),
  };
}
