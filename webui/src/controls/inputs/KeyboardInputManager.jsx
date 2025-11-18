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
const BINDING_CODE_MAP = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
};
const CODE_PREFIX = 'code:';
const KEY_PREFIX = 'key:';

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

function canonicalizeValue(value) {
  if (typeof value !== 'string') return '';
  const lower = value.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function deriveCodeForValue(value) {
  if (!value) return null;
  if (BINDING_CODE_MAP[value]) return BINDING_CODE_MAP[value];
  if (value.length === 1) {
    if (/[a-z]/.test(value)) return `Key${value.toUpperCase()}`;
    if (/[0-9]/.test(value)) return `Digit${value}`;
  }
  return null;
}

function makeKeyToken(value) {
  const canonical = canonicalizeValue(value);
  return canonical ? `${KEY_PREFIX}${canonical}` : null;
}

function makeCodeToken(value) {
  const canonical = canonicalizeValue(value);
  const code = deriveCodeForValue(canonical);
  return code ? `${CODE_PREFIX}${code}` : null;
}

function tokensFromEvent(event) {
  const tokens = new Set();
  const keyToken = makeKeyToken(event?.key ?? '');
  if (keyToken) tokens.add(keyToken);
  const code = event?.code;
  if (code) {
    tokens.add(`${CODE_PREFIX}${code}`);
  }
  return Array.from(tokens);
}

function normalizeKeymap(keymap = {}) {
  const entries = Object.entries(keymap).map(([action, bindings]) => {
    const values = Array.isArray(bindings) ? bindings : [bindings];
    const normalized = new Set();
    values.forEach((value) => {
      const keyToken = makeKeyToken(String(value));
      if (keyToken) normalized.add(keyToken);
      const codeToken = makeCodeToken(String(value));
      if (codeToken) normalized.add(codeToken);
    });
    return [action, normalized];
  });
  return Object.fromEntries(entries);
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
  const actionTokens = useMemo(() => {
    const tokens = new Set();
    Object.values(keymap).forEach((bindingSet) => {
      if (!bindingSet) return;
      bindingSet.forEach((token) => tokens.add(token));
    });
    return tokens;
  }, [keymap]);
  const servoStep = useMemo(
    () => Math.abs(state.camera?.config?.nudgeDegrees || 1),
    [state.camera?.config?.nudgeDegrees],
  );

  const activeTokensRef = useRef(new Set());
  const lastVectorRef = useRef(ZERO_VECTOR);
  const lastAuxRef = useRef(ZERO_AUX);
  const servoIntervalRef = useRef(null);

  const driveFromKeys = useCallback(() => {
    const tokensSnapshot = new Set(activeTokensRef.current);
    const vector = computeDriveVector(tokensSnapshot, keymap);
    const aux = computeAuxMotors(tokensSnapshot, keymap);
    if (
      vector.x !== lastVectorRef.current.x ||
      vector.y !== lastVectorRef.current.y ||
      vector.boost !== lastVectorRef.current.boost
    ) {
      lastVectorRef.current = vector;
      setDriveVector(vector, { source: SOURCE });
    }
    if (
      aux.main !== lastAuxRef.current.main ||
      aux.side !== lastAuxRef.current.side ||
      aux.vacuum !== lastAuxRef.current.vacuum
    ) {
      lastAuxRef.current = aux;
      setAuxMotors(aux);
    }
    registerInputState(SOURCE, {
      keys: Array.from(tokensSnapshot),
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

  const computeServoDirection = useCallback(() => {
    const tokensSnapshot = new Set(activeTokensRef.current);
    const up = bindingActive(keymap.cameraUp, tokensSnapshot);
    const down = bindingActive(keymap.cameraDown, tokensSnapshot);
    return (up ? 1 : 0) - (down ? 1 : 0);
  }, [keymap]);

  const ensureServoLoop = useCallback(() => {
    const direction = computeServoDirection();
    if (direction === 0) {
      stopServoLoop();
      return;
    }
    if (servoIntervalRef.current) {
      return;
    }
    const tick = () => {
      const nextDirection = computeServoDirection();
      if (nextDirection === 0) {
        stopServoLoop();
        return;
      }
      nudgeServo(nextDirection * servoStep);
      servoIntervalRef.current = setTimeout(tick, SERVO_REPEAT_MS);
    };
    servoIntervalRef.current = setTimeout(tick, 0);
  }, [computeServoDirection, nudgeServo, servoStep, stopServoLoop]);

  const resetAll = useCallback(() => {
    activeTokensRef.current.clear();
    lastVectorRef.current = ZERO_VECTOR;
    lastAuxRef.current = ZERO_AUX;
    stopServoLoop();
    stopAllMotion();
    registerInputState(SOURCE, { keys: [], vector: ZERO_VECTOR, aux: ZERO_AUX });
  }, [registerInputState, stopAllMotion, stopServoLoop]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (shouldIgnoreEvent(event)) return;
      const tokens = tokensFromEvent(event);
      if (tokens.length === 0) return;
      if (tokens.some((token) => actionTokens.has(token))) {
        event.preventDefault();
      }
      const newlyPressed = tokens.filter((token) => !activeTokensRef.current.has(token));
      newlyPressed.forEach((token) => activeTokensRef.current.add(token));

      if (newlyPressed.length > 0) {
        if (newlyPressed.some((token) => keymap.driveMacro?.has(token))) {
          setMode('drive');
          runMacro('drive-sequence');
        } else if (newlyPressed.some((token) => keymap.dockMacro?.has(token))) {
          setMode('dock');
          runMacro('seek-dock');
        }
      }

      ensureServoLoop();
      driveFromKeys();
    }

    function handleKeyUp(event) {
      const tokens = tokensFromEvent(event);
      tokens.forEach((token) => activeTokensRef.current.delete(token));
      ensureServoLoop();
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
  }, [actionTokens, driveFromKeys, ensureServoLoop, keymap.dockMacro, keymap.driveMacro, resetAll, runMacro, setMode]);

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
