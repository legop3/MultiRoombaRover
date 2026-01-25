import { useEffect, useState } from 'react';
import { getPadSignature } from './gamepadBindings.js';

const listeners = new Set();
let rafId = null;
let lastState = { pads: [], timestamp: 0 };

function readGamepads() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) {
    return [];
  }
  const pads = navigator.getGamepads();
  if (!pads) return [];
  return Array.from(pads).filter(Boolean);
}

function buildPadState(pad) {
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
    signature: getPadSignature(pad),
  };
}

function updateState() {
  const pads = readGamepads().map(buildPadState);
  lastState = {
    pads,
    timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
  listeners.forEach((listener) => listener(lastState));
}

function loop() {
  updateState();
  rafId = requestAnimationFrame(loop);
}

function startLoop() {
  if (rafId) return;
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

export function subscribeGamepadHub(listener) {
  listeners.add(listener);
  startLoop();
  listener(lastState);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopLoop();
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
