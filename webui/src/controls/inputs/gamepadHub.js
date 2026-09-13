// Gamepad Hub Runtime
// Purpose: Tracks connected gamepads and polls input state for downstream handlers. Scope: Encapsulates browser Gamepad API access and per-frame update orchestration.
import { useEffect, useState } from 'react';
import { getPadSignature } from './gamepadBindings.js';

const listeners = new Set();
let rafId = null;
let lastState = { pads: [], timestamp: 0, supported: true, error: null };
let hasDeviceListeners = false;
let deviceChangeHandler = null;
let lastReadError = null;

function hasConnectedPads() {
  return readGamepads().some((pad) => pad?.connected !== false);
}

function readGamepads() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) {
    lastReadError = new Error('This browser does not support the Gamepad API.');
    return [];
  }
  try {
    const pads = navigator.getGamepads();
    lastReadError = null;
    if (!pads) return [];
    return Array.from(pads).filter(Boolean);
  } catch (error) {
    /* Permissions Policy can make getGamepads throw instead of returning an empty list. Preserve
       that distinction so the setup UI can explain why reconnecting hardware will not help. */
    lastReadError = error instanceof Error ? error : new Error(String(error));
    return [];
  }
}

function buildPadState(pad) {
  const signature = getPadSignature(pad);
  return {
    index: pad.index,
    id: pad.id,
    mapping: pad.mapping,
    connected: pad.connected !== false,
    timestamp: pad.timestamp,
    axes: Array.from(pad.axes ?? []),
    buttons: (pad.buttons ?? []).map((btn) => ({
      pressed: Boolean(btn?.pressed),
      value: typeof btn?.value === 'number' ? btn.value : btn?.pressed ? 1 : 0,
    })),
    signature,
    instanceKey: `${signature}::slot-${pad.index}`,
  };
}

function updateState() {
  const pads = readGamepads().map(buildPadState);
  lastState = {
    pads,
    timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    supported: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
    error: lastReadError?.message ?? null,
  };
  listeners.forEach((listener) => listener(lastState));
}

function loop() {
  updateState();
  if (lastState.pads.length === 0) {
    stopLoop();
    return;
  }
  rafId = requestAnimationFrame(loop);
}

function startLoop() {
  if (rafId) return;
  updateState();
  if (lastState.pads.length === 0) return;
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

export function subscribeGamepadHub(listener) {
  listeners.add(listener);
  if (!hasDeviceListeners && typeof window !== 'undefined') {
    const handleDeviceChange = () => {
      updateState();
      if (listeners.size === 0) return;
      if (hasConnectedPads()) {
        startLoop();
      } else {
        stopLoop();
      }
    };
    window.addEventListener('gamepadconnected', handleDeviceChange);
    window.addEventListener('gamepaddisconnected', handleDeviceChange);
    deviceChangeHandler = handleDeviceChange;
    hasDeviceListeners = true;
  }
  if (hasConnectedPads()) {
    startLoop();
  } else {
    updateState();
  }
  listener(lastState);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopLoop();
      if (hasDeviceListeners && typeof window !== 'undefined') {
        window.removeEventListener('gamepadconnected', deviceChangeHandler);
        window.removeEventListener('gamepaddisconnected', deviceChangeHandler);
        deviceChangeHandler = null;
        hasDeviceListeners = false;
      }
    }
  };
}

export function getGamepadHubState() {
  return lastState;
}

export function useGamepadHubState() {
  const [state, setState] = useState(lastState);

  useEffect(() => {
    return subscribeGamepadHub(setState);
  }, []);

  return state;
}
