// PTZ Control Adapter
// Purpose: Hooks the single PTZ camera into the internal control action layer.
// Scope: Owns PTZ-specific control mixing and socket commands so keyboard,
// mobile, desktop, and gamepad inputs do not each learn camera-specific rules.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';

const PTZ_STOP = { pan: 0, tilt: 0, zoom: 0 };
const PTZ_SPEEDS = {
  slow: 0.1,
  medium: 0.5,
  fast: 1,
};
// The TrackMix advertises a minimum ONVIF movement timeout of one second. A
// quarter-second browser heartbeat gives the server several opportunities to
// renew a genuinely held intent while still letting its watchdog distinguish a
// live control from a browser that disappeared without delivering a release.
const MOTION_HEARTBEAT_MS = 250;

function clampUnit(value) {
  const number = Number(value) || 0;
  return Math.max(-1, Math.min(1, number));
}

function axisSign(value) {
  const number = Number(value) || 0;
  if (number > 0.05) return 1;
  if (number < -0.05) return -1;
  return 0;
}

function pickPanTiltSpeed(vector = {}, meta = {}) {
  /*
    PTZ movement should not inherit rover wheel speeds. Inputs only choose a
    speed tier here: precision/low-magnitude input is slow, normal input is
    medium, and explicit boost is fast. That gives every control surface the
    same camera feel without remixing differential-drive output.
  */
  if (vector?.boost) return PTZ_SPEEDS.fast;
  const maxAxis = Math.max(Math.abs(Number(vector?.x) || 0), Math.abs(Number(vector?.y) || 0));
  const baseSpeed = Number(meta?.speedOptions?.baseSpeed);
  if (maxAxis > 0 && maxAxis <= 0.45) return PTZ_SPEEDS.slow;
  if (Number.isFinite(baseSpeed) && baseSpeed > 0 && baseSpeed <= 150) return PTZ_SPEEDS.slow;
  return PTZ_SPEEDS.medium;
}

function payloadSignature(payload = PTZ_STOP) {
  return [
    Number(payload.pan || 0).toFixed(3),
    Number(payload.tilt || 0).toFixed(3),
    Number(payload.zoom || 0).toFixed(3),
  ].join(':');
}

function isIdlePayload(payload = PTZ_STOP) {
  return !payload.pan && !payload.tilt && !payload.zoom;
}

function buildPanTiltPayload(vector = {}, meta = {}) {
  const panSign = axisSign(vector.x);
  const tiltSign = axisSign(vector.y);
  if (!panSign && !tiltSign) return PTZ_STOP;

  const speed = pickPanTiltSpeed(vector, meta);
  const diagonalScale = panSign && tiltSign ? Math.SQRT1_2 : 1;
  return {
    pan: clampUnit(panSign * speed * diagonalScale),
    tilt: clampUnit(tiltSign * speed * diagonalScale),
    zoom: 0,
  };
}

function isSpotlightOn(light = {}) {
  if (typeof light?.on === 'boolean') return light.on;
  const raw = light?.state;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return !['', '0', 'off', 'false'].includes(normalized);
  }
  return Boolean(Number(raw));
}

function normalizeIrMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'on') return 'On';
  if (normalized === 'off') return 'Off';
  return 'Auto';
}

function nextIrMode(currentMode) {
  /*
    The rover laser button becomes the PTZ camera's IR mode control while the
    PTZ camera is active. Cycle all three modes exposed by this Reolink camera
    instead of reducing the control to a two-state toggle.
  */
  const current = normalizeIrMode(currentMode);
  if (current === 'Auto') return 'On';
  if (current === 'On') return 'Off';
  return 'Auto';
}

export function usePtzControlAdapter() {
  const socket = useSocket();
  const { ptzSpotlight, ptzIr } = useSessionActions();
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isActive = Boolean(ptz?.isOperator);
  const lastMotionSignatureRef = useRef(payloadSignature(PTZ_STOP));
  const desiredMotionRef = useRef(PTZ_STOP);
  const panTiltIntentRef = useRef({ pan: 0, tilt: 0 });
  const zoomIntentRef = useRef(0);
  const heartbeatTimerRef = useRef(null);

  const emitPtz = useCallback(
    (eventName, payload = {}) => {
      if (!socket || !isActive) return;
      socket.emit(eventName, payload);
    },
    [isActive, socket],
  );

  const clearHeartbeat = useCallback(() => {
    if (!heartbeatTimerRef.current) return;
    clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }, []);

  const publishMotion = useCallback(
    (payload, options = {}) => {
      if (!isActive) return false;
      const nextPayload = {
        pan: clampUnit(payload?.pan),
        tilt: clampUnit(payload?.tilt),
        zoom: clampUnit(payload?.zoom),
      };
      const nextSignature = payloadSignature(nextPayload);
      desiredMotionRef.current = nextPayload;

      if (isIdlePayload(nextPayload)) {
        clearHeartbeat();
      } else if (!heartbeatTimerRef.current) {
        /*
          Movement is renewed from the complete desired vector, not from the
          individual input event that happened to start it. This is what makes
          pan/tilt and zoom independent: every heartbeat describes all axes as
          they should be now, and no delayed zoom pulse can resurrect an older
          direction after a release.
        */
        heartbeatTimerRef.current = setInterval(() => {
          const current = desiredMotionRef.current;
          if (isIdlePayload(current)) {
            clearHeartbeat();
            return;
          }
          emitPtz('ptzCamera:motion', current);
        }, MOTION_HEARTBEAT_MS);
      }

      if (!options.force && lastMotionSignatureRef.current === nextSignature) return true;
      lastMotionSignatureRef.current = nextSignature;
      // Zero is a first-class desired state. The server translates the complete
      // idle vector into ONVIF Stop inside the same serialized command stream as
      // movement, which prevents separate move/stop handlers from racing.
      emitPtz('ptzCamera:motion', nextPayload);
      return true;
    },
    [clearHeartbeat, emitPtz, isActive],
  );

  const stopMotion = useCallback(
    (options = {}) => {
      // A global stop deliberately clears every axis. Safety/lifecycle callers
      // use force so the server receives a fresh stop even when the browser's
      // local signature already says it is idle after a dropped connection.
      panTiltIntentRef.current = { pan: 0, tilt: 0 };
      zoomIntentRef.current = 0;
      return publishMotion(PTZ_STOP, { force: Boolean(options.force) });
    },
    [publishMotion],
  );

  const applyDriveVector = useCallback(
    (vector, meta = {}) => {
      if (!isActive) return false;
      const panTilt = buildPanTiltPayload(vector, meta);
      panTiltIntentRef.current = {
        pan: panTilt.pan,
        tilt: panTilt.tilt,
      };
      /*
        ONVIF continuous movement accepts pan, tilt, and zoom in one command.
        Preserve the current zoom intent when a direction update arrives so a
        keyboard or touch event on one axis cannot erase another held axis.
      */
      publishMotion({
        ...panTiltIntentRef.current,
        zoom: zoomIntentRef.current,
      });
      return true;
    },
    [isActive, publishMotion],
  );

  const setZoomIntent = useCallback(
    (direction) => {
      if (!isActive) return false;
      const numeric = clampUnit(direction);
      const sign = axisSign(numeric);
      /*
        PTZ zoom is a held velocity, not a rover servo nudge. Convert the input
        magnitude to the same precision/normal tiers used for pan and tilt, then
        retain it until the input surface explicitly publishes zero. The shared
        heartbeat renews that state; there are no per-button repeat or delayed
        stop timers left to race with pointer/key release.
      */
      const speed = !sign ? 0 : Math.abs(numeric) <= 0.45 ? PTZ_SPEEDS.slow : PTZ_SPEEDS.medium;
      zoomIntentRef.current = sign * speed;
      publishMotion({
        ...panTiltIntentRef.current,
        zoom: zoomIntentRef.current,
      });
      return true;
    },
    [isActive, publishMotion],
  );

  const setSpotlight = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const desiredOn = typeof nextOn === 'boolean' ? nextOn : !isSpotlightOn(ptz?.light);
      /*
        Lighting keybinds should use the exact acknowledged command action as
        the visible PTZ buttons. Movement remains fire-and-forget because it is
        continuous and high frequency, but a discrete light toggle benefits
        from the existing authorization/error contract and must not maintain a
        second socket-only behavior merely because its source is a keybind.
      */
      ptzSpotlight({ state: desiredOn ? 1 : 0 }).catch(() => {});
      return true;
    },
    [isActive, ptz?.light, ptzSpotlight],
  );

  const setIr = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const desiredState = typeof nextOn === 'boolean'
        ? (nextOn ? 'On' : 'Off')
        : nextIrMode(ptz?.ir?.state);
      // Match the button path for the same reason as spotlight above. The
      // shared laser key continues to select IR; only its transport is unified.
      ptzIr({ state: desiredState }).catch(() => {});
      return true;
    },
    [isActive, ptz?.ir?.state, ptzIr],
  );

  useEffect(() => {
    if (isActive) return undefined;
    lastMotionSignatureRef.current = payloadSignature(PTZ_STOP);
    desiredMotionRef.current = PTZ_STOP;
    panTiltIntentRef.current = { pan: 0, tilt: 0 };
    zoomIntentRef.current = 0;
    clearHeartbeat();
    return undefined;
  }, [clearHeartbeat, isActive]);

  useEffect(() => {
    if (!isActive) return undefined;

    const forceSafetyStop = () => stopMotion({ force: true });
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') forceSafetyStop();
    };

    /*
      Input components handle ordinary pointer/key releases, but the adapter is
      the only layer guaranteed to see every PTZ control surface. Centralizing
      browser lifecycle stops here covers touch, keyboard, and gamepad equally
      when a tab hides, a window blurs, or mobile navigation fires pagehide.
    */
    window.addEventListener('blur', forceSafetyStop);
    window.addEventListener('pagehide', forceSafetyStop);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', forceSafetyStop);
      window.removeEventListener('pagehide', forceSafetyStop);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive, stopMotion]);

  useEffect(
    () => () => {
      clearHeartbeat();
    },
    [clearHeartbeat],
  );

  return useMemo(
    () => ({
      isActive,
      state: ptz,
      applyDriveVector,
      setZoomIntent,
      setSpotlight,
      setIr,
      stopMotion,
    }),
    [applyDriveVector, isActive, ptz, setIr, setSpotlight, setZoomIntent, stopMotion],
  );
}
