import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControlSystem } from '../ControlContext.jsx';

const SOURCE = 'keyboard';
const ZERO_VECTOR = { x: 0, y: 0, boost: false };
const ZERO_AUX = { main: 0, side: 0, vacuum: 0 };
const SERVO_REPEAT_MS = 110;
const KEY_ALIASES = {
  '{': '[',
  '}': ']',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '|': '\\',
  '_': '-',
  '+': '=',
};
const CODE_ALIASES = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
};

function shouldIgnoreEvent(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable ||
    tag === 'SELECT'
  );
}

function canonicalizeBinding(value) {
  if (typeof value !== 'string') return '';
  const lower = value.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function normalizeKeymap(keymap = {}) {
  const entries = Object.entries(keymap).map(([action, bindings]) => {
    const values = Array.isArray(bindings) ? bindings : [bindings];
    const normalized = new Set(values.map((value) => canonicalizeBinding(String(value))));
    return [action, normalized];
  });
  return Object.fromEntries(entries);
}

function canonicalizeEventKey(event) {
  if (!event) return '';
  const code = event.code;
  if (code && CODE_ALIASES[code]) {
    return CODE_ALIASES[code];
  }
  const key = event.key ?? '';
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function bindingHas(bindingSet, key) {
  if (!bindingSet || bindingSet.size === 0) return false;
  return bindingSet.has(key);
}

function bindingActive(bindingSet, keys) {
  if (!bindingSet || bindingSet.size === 0) return false;
  for (const key of keys) {
    if (bindingSet.has(key)) return true;
  }
  return false;
}

function computeDriveVector(keys, keymap) {
  const forward = bindingActive(keymap.driveForward, keys);
  const backward = bindingActive(keymap.driveBackward, keys);
  const left = bindingActive(keymap.driveLeft, keys);
  const right = bindingActive(keymap.driveRight, keys);
  const boost = bindingActive(keymap.boostModifier, keys);
  const slow = bindingActive(keymap.slowModifier, keys);

  let y = 0;
  if (forward && !backward) y = 1;
  else if (backward && !forward) y = -1;

  let x = 0;
  if (left && !right) x = -1;
  else if (right && !left) x = 1;

  const scale = slow ? 0.4 : 1;
  return {
    x: x * scale,
    y: y * scale,
    boost: boost && !slow,
  };
}

function computeAuxMotors(keys, keymap) {
  const allForward = bindingActive(keymap.auxAllForward, keys);
  if (allForward) {
    return { main: 127, side: 127, vacuum: 127 };
  }
  const main = bindingActive(keymap.auxMainForward, keys)
    ? 127
    : bindingActive(keymap.auxMainReverse, keys)
    ? -127
    : 0;
  const side = bindingActive(keymap.auxSideForward, keys)
    ? 127
    : bindingActive(keymap.auxSideReverse, keys)
    ? -70
    : 0;
  const vacuum = bindingActive(keymap.auxVacuumFast, keys)
    ? 127
    : bindingActive(keymap.auxVacuumSlow, keys)
    ? 50
    : 0;
  return { main, side, vacuum };
}

function vectorsEqual(a, b) {
  return (
    a &&
    b &&
    a.x === b.x &&
    a.y === b.y &&
    a.boost === b.boost
  );
}

function auxEqual(a, b) {
  return a && b && a.main === b.main && a.side === b.side && a.vacuum === b.vacuum;
}

export default function KeyboardInputManager() {
  const {
    state,
    actions: {
      setMode,
      setDriveVector,
      setAuxMotors,
      nudgeServo,
      runMacro,
      stopAllMotion,
      registerInputState,
    },
  } = useControlSystem();
  const keymap = useMemo(() => normalizeKeymap(state.keymap), [state.keymap]);
  const servoStep = Math.abs(state.camera?.config?.nudgeDegrees) || 1;
  const pressedKeysRef = useRef(new Set());
  const lastVectorRef = useRef(ZERO_VECTOR);
  const lastAuxRef = useRef(ZERO_AUX);
  const cameraHoldRef = useRef(new Set());
  const servoIntervalRef = useRef(null);

  const actionKeys = useMemo(() => {
    const entries = Object.values(keymap);
    const set = new Set();
    entries.forEach((bindingSet) => {
      bindingSet?.forEach((binding) => set.add(binding));
    });
    return set;
  }, [keymap]);

  const driveFromKeys = useCallback(() => {
    const keys = pressedKeysRef.current;
    const vector = computeDriveVector(keys, keymap);
    const aux = computeAuxMotors(keys, keymap);
    if (!vectorsEqual(vector, lastVectorRef.current)) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }
    if (!auxEqual(aux, lastAuxRef.current)) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }
    registerInputState(SOURCE, {
      keys: Array.from(keys),
      vector,
      aux,
    });
  }, [keymap, registerInputState, setAuxMotors, setDriveVector]);

  const stopServoLoop = useCallback(() => {
    if (servoIntervalRef.current) {
      clearTimeout(servoIntervalRef.current);
      servoIntervalRef.current = null;
    }
  }, []);

  const startServoLoop = useCallback(() => {
    if (servoIntervalRef.current) return;
    const tick = () => {
      const up = cameraHoldRef.current.has('up') ? 1 : 0;
      const down = cameraHoldRef.current.has('down') ? 1 : 0;
      const direction = up - down;
      if (direction === 0) {
        servoIntervalRef.current = null;
        return;
      }
      nudgeServo(direction * servoStep);
      servoIntervalRef.current = setTimeout(tick, SERVO_REPEAT_MS);
    };
    servoIntervalRef.current = setTimeout(tick, 0);
  }, [nudgeServo, servoStep]);

  const updateServoHold = useCallback(() => {
    if (cameraHoldRef.current.size === 0) {
      stopServoLoop();
    } else {
      startServoLoop();
    }
  }, [startServoLoop, stopServoLoop]);

  const resetAll = useCallback(() => {
    pressedKeysRef.current.clear();
    cameraHoldRef.current.clear();
    stopServoLoop();
    lastVectorRef.current = ZERO_VECTOR;
    lastAuxRef.current = ZERO_AUX;
    stopAllMotion();
    registerInputState(SOURCE, { keys: [], vector: ZERO_VECTOR, aux: ZERO_AUX });
  }, [registerInputState, stopAllMotion, stopServoLoop]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (shouldIgnoreEvent(event)) return;
      const key = canonicalizeEventKey(event);
      if (!key) return;
      if (actionKeys.has(key)) {
        event.preventDefault();
      }
      if (!pressedKeysRef.current.has(key)) {
        pressedKeysRef.current.add(key);
      }

      if (bindingHas(keymap.driveMacro, key)) {
        setMode('drive');
        runMacro('drive-sequence');
      } else if (bindingHas(keymap.dockMacro, key)) {
        setMode('dock');
        runMacro('seek-dock');
      } else if (bindingHas(keymap.cameraUp, key)) {
        cameraHoldRef.current.add('up');
        updateServoHold();
      } else if (bindingHas(keymap.cameraDown, key)) {
        cameraHoldRef.current.add('down');
        updateServoHold();
      }

      driveFromKeys();
    }

    function handleKeyUp(event) {
      const key = canonicalizeEventKey(event);
      if (!key || !pressedKeysRef.current.has(key)) {
        if (bindingHas(keymap.cameraUp, key)) {
          cameraHoldRef.current.delete('up');
          updateServoHold();
        } else if (bindingHas(keymap.cameraDown, key)) {
          cameraHoldRef.current.delete('down');
          updateServoHold();
        }
        return;
      }

      pressedKeysRef.current.delete(key);

      if (bindingHas(keymap.cameraUp, key)) {
        cameraHoldRef.current.delete('up');
        updateServoHold();
      } else if (bindingHas(keymap.cameraDown, key)) {
        cameraHoldRef.current.delete('down');
        updateServoHold();
      }

      driveFromKeys();
    }

    function handleBlur() {
      resetAll();
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [actionKeys, driveFromKeys, keymap, resetAll, runMacro, setMode, updateServoHold]);

  useEffect(() => {
    resetAll();
  }, [state.roverId, resetAll]);

  useEffect(
    () => () => {
      stopServoLoop();
    },
    [stopServoLoop],
  );

  return null;
}
