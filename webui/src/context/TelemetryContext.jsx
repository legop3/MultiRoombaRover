// Telemetry Context Provider
// Purpose: Maintains shared telemetry snapshots and rover status streams for UI consumers. Scope: Subscribes to telemetry events and exposes normalized read APIs to components.
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useSessionSelector } from './SessionContext.jsx';

const EMPTY_FRAMES = Object.freeze({});
const EMPTY_FRAME = null;
const DEFAULT_VISUAL_THROTTLE_MS = 250;

const TelemetryContext = createContext(null);

export function shallowArrayEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let idx = 0; idx < left.length; idx += 1) {
    if (!Object.is(left[idx], right[idx])) return false;
  }
  return true;
}

export function shallowObjectEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function selectFrameIdentity(frame) {
  return frame;
}

export function TelemetryProvider({ children }) {
  const socket = useSocket();
  const sessionRole = useSessionSelector((state) => state.session?.role || null);
  const framesRef = useRef({});
  const roverSubscribersRef = useRef(new Map());
  const allSubscribersRef = useRef(new Set());
  const visualAllSubscribersRef = useRef(new Set());
  const selectorSubscribersRef = useRef(new Map());
  const pendingVisualRoversRef = useRef(new Set());
  const visualAllPendingRef = useRef(false);
  const sessionRoleRef = useRef(sessionRole);
  const visualPolicyRef = useRef({ mobile: false });
  const visualTimerRef = useRef(null);
  sessionRoleRef.current = sessionRole;

  const defaultVisualThrottleMs = () => {
    // The throttle policy is intentionally sourced from existing app state:
    // session role identifies spectator-style pages, and App publishes its
    // already-computed layout mode. Telemetry should not independently inspect
    // paths or viewport dimensions because that would duplicate page policy and
    // drift from the rest of the UI.
    const spectator = sessionRoleRef.current === 'spectator';
    const mobile = Boolean(visualPolicyRef.current.mobile);
    return spectator || mobile ? DEFAULT_VISUAL_THROTTLE_MS : 0;
  };

  const throttleMsForEntry = (entry) => (
    Number.isFinite(entry.throttleMs) ? entry.throttleMs : defaultVisualThrottleMs()
  );

  const notifyRover = (roverId) => {
    const listeners = roverSubscribersRef.current.get(roverId);
    if (listeners) {
      listeners.forEach((listener) => listener());
    }
    allSubscribersRef.current.forEach((listener) => listener());
  };

  const evaluateSelectorEntries = (roverId, entries) => {
    const frame = framesRef.current[roverId] ?? EMPTY_FRAME;
    entries.forEach((entry) => {
      const nextValue = entry.selector(frame);
      if (entry.equalityFn(entry.currentValue, nextValue)) return;
      entry.currentValue = nextValue;
      entry.listener(nextValue);
    });
  };

  const notifyRawSelectors = (roverId) => {
    const entries = selectorSubscribersRef.current.get(roverId);
    if (!entries) return;
    evaluateSelectorEntries(
      roverId,
      [...entries].filter((entry) => entry.mode !== 'visual'),
    );
  };

  const flushVisualSelectors = () => {
    visualTimerRef.current = null;
    const roverIds = [...pendingVisualRoversRef.current];
    pendingVisualRoversRef.current.clear();
    roverIds.forEach((roverId) => {
      const entries = selectorSubscribersRef.current.get(roverId);
      if (!entries) return;
      evaluateSelectorEntries(
        roverId,
        [...entries].filter((entry) => entry.mode === 'visual' && throttleMsForEntry(entry) > 0),
      );
    });
    if (visualAllPendingRef.current) {
      visualAllPendingRef.current = false;
      visualAllSubscribersRef.current.forEach((listener) => listener());
    }
  };

  const notifyVisualSelectors = (roverId) => {
    const entries = selectorSubscribersRef.current.get(roverId);
    if (!entries) return;
    const visualEntries = [...entries].filter((entry) => entry.mode === 'visual');
    const immediateEntries = visualEntries.filter((entry) => throttleMsForEntry(entry) <= 0);
    const throttledEntries = visualEntries.filter((entry) => throttleMsForEntry(entry) > 0);

    // Desktop visual subscriptions still benefit from field-level selectors, but
    // they do not need cadence throttling. Evaluate those entries immediately so
    // desktop dashboards keep the same responsiveness they had before this change.
    if (immediateEntries.length) {
      evaluateSelectorEntries(roverId, immediateEntries);
    }
    if (!throttledEntries.length) return;

    pendingVisualRoversRef.current.add(roverId);
    if (visualTimerRef.current) return;

    const delay = throttledEntries.reduce(
      (lowest, entry) => Math.min(lowest, throttleMsForEntry(entry)),
      DEFAULT_VISUAL_THROTTLE_MS,
    );
    visualTimerRef.current = setTimeout(flushVisualSelectors, delay);
  };

  const notifyVisualAll = () => {
    const throttleMs = defaultVisualThrottleMs();
    if (throttleMs <= 0) {
      visualAllSubscribersRef.current.forEach((listener) => listener());
      return;
    }
    visualAllPendingRef.current = true;
    if (visualTimerRef.current) return;
    visualTimerRef.current = setTimeout(flushVisualSelectors, throttleMs);
  };

  const store = useMemo(
    () => ({
      getFrames: () => framesRef.current,
      getFrame: (roverId) => {
        if (!roverId) return EMPTY_FRAME;
        return framesRef.current[roverId] ?? EMPTY_FRAME;
      },
      subscribeAll: (listener) => {
        allSubscribersRef.current.add(listener);
        return () => {
          allSubscribersRef.current.delete(listener);
        };
      },
      subscribeAllVisual: (listener) => {
        visualAllSubscribersRef.current.add(listener);
        return () => {
          visualAllSubscribersRef.current.delete(listener);
        };
      },
      setVisualPolicy: (policy = {}) => {
        visualPolicyRef.current = {
          ...visualPolicyRef.current,
          ...policy,
        };
      },
      subscribeRover: (roverId, listener) => {
        if (!roverId) return () => {};
        let listeners = roverSubscribersRef.current.get(roverId);
        if (!listeners) {
          listeners = new Set();
          roverSubscribersRef.current.set(roverId, listeners);
        }
        listeners.add(listener);
        return () => {
          const current = roverSubscribersRef.current.get(roverId);
          if (!current) return;
          current.delete(listener);
          if (!current.size) {
            roverSubscribersRef.current.delete(roverId);
          }
        };
      },
      subscribeSelector: (roverId, selector, listener, equalityFn = Object.is, options = {}) => {
        if (!roverId || typeof selector !== 'function') return () => {};
        let listeners = selectorSubscribersRef.current.get(roverId);
        if (!listeners) {
          listeners = new Set();
          selectorSubscribersRef.current.set(roverId, listeners);
        }

        const mode = options.mode === 'visual' ? 'visual' : 'raw';
        const throttleMs =
          mode === 'visual' && Number.isFinite(options.throttleMs)
            ? Math.max(0, options.throttleMs)
            : null;
        const entry = {
          selector,
          listener,
          equalityFn,
          mode,
          throttleMs,
          // The current value is stored with the subscription so selector
          // equality is checked before React is notified. This keeps unrelated
          // sensor fields from invalidating components that do not read them.
          currentValue: selector(framesRef.current[roverId] ?? EMPTY_FRAME),
        };
        listeners.add(entry);

        // React renders before effects subscribe. A sensor frame can therefore
        // arrive after the hook's render-time read but before this entry exists.
        // Publish the exact snapshot used to initialize the subscription so the
        // component cannot remain stuck on that stale render-time value until a
        // selected field changes again. Registering first is important: any
        // frame arriving after this point will also notify the listener normally.
        listener(entry.currentValue);
        return () => {
          const current = selectorSubscribersRef.current.get(roverId);
          if (!current) return;
          current.delete(entry);
          if (!current.size) {
            selectorSubscribersRef.current.delete(roverId);
          }
        };
      },
    }),
    [],
  );

  useEffect(() => {
    function handleSensorFrame({ roverId, sensors = {}, frame = {}, overcurrentProtection = null }) {
      if (!roverId) return;
      const previous = framesRef.current[roverId] ?? {};
      framesRef.current = {
        ...framesRef.current,
        [roverId]: {
          ...previous,
          roverId,
          sensors,
          // Protection is server-calculated policy state, not a native Roomba
          // sensor. Keeping it beside `sensors` preserves that distinction while
          // allowing selectors to read one coherent telemetry snapshot.
          overcurrentProtection,
          raw: frame?.data || null,
          receivedAt: Date.now(),
        },
      };
      notifyRover(roverId);
      notifyRawSelectors(roverId);
      notifyVisualSelectors(roverId);
      notifyVisualAll();
    }

    function handleRoverHostStats({ roverId, stats = {}, receivedAt = null }) {
      if (!roverId) return;
      const previous = framesRef.current[roverId] ?? {};
      const now = Date.now();
      framesRef.current = {
        ...framesRef.current,
        [roverId]: {
          ...previous,
          roverId,
          // Host stats are Pi/Linux metadata. They live beside sensors so UI
          // consumers can render Pi health without treating it as raw Roomba
          // sensor data.
          hostStats: stats,
          hostStatsReceivedAt: Number.isFinite(receivedAt) ? receivedAt : now,
        },
      };
      notifyRover(roverId);
      notifyRawSelectors(roverId);
      notifyVisualSelectors(roverId);
      notifyVisualAll();
    }

    socket.on('sensorFrame', handleSensorFrame);
    socket.on('roverHostStats', handleRoverHostStats);
    return () => {
      socket.off('sensorFrame', handleSensorFrame);
      socket.off('roverHostStats', handleRoverHostStats);
      if (visualTimerRef.current) {
        clearTimeout(visualTimerRef.current);
        visualTimerRef.current = null;
      }
    };
    // The notification helpers above read only refs and constants; tying this
    // socket subscription to their render-time identities would churn socket
    // listeners without changing what data they read. The socket object is the
    // actual external dependency that should resubscribe this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  return <TelemetryContext.Provider value={store}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryFrames() {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetryFrames must be used within TelemetryProvider');
  }
  return useSyncExternalStore(store.subscribeAll, store.getFrames, () => EMPTY_FRAMES);
}

export function useVisualTelemetryFrames() {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useVisualTelemetryFrames must be used within TelemetryProvider');
  }
  return useSyncExternalStore(store.subscribeAllVisual, store.getFrames, () => EMPTY_FRAMES);
}

export function useTelemetryVisualPolicy(policy) {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetryVisualPolicy must be used within TelemetryProvider');
  }

  const mobile = Boolean(policy?.mobile);
  useEffect(() => {
    store.setVisualPolicy({ mobile });
    return () => {
      store.setVisualPolicy({ mobile: false });
    };
  }, [mobile, store]);
}

export function useTelemetryFrame(roverId) {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetryFrame must be used within TelemetryProvider');
  }
  return useSyncExternalStore(
    (listener) => store.subscribeRover(roverId, listener),
    () => store.getFrame(roverId),
    () => EMPTY_FRAME,
  );
}

export function useTelemetrySelector(roverId, selector = selectFrameIdentity, equalityFn = Object.is, options = {}) {
  const store = useContext(TelemetryContext);
  if (!store) {
    throw new Error('useTelemetrySelector must be used within TelemetryProvider');
  }
  const mode = options.mode === 'visual' ? 'visual' : 'raw';
  const throttleMs = Number.isFinite(options.throttleMs) ? Math.max(0, options.throttleMs) : undefined;
  const [selectionState, setSelectionState] = useState(() => ({
    roverId,
    selector,
    value: selector(store.getFrame(roverId)),
  }));
  const renderedSelected =
    selectionState.roverId === roverId && selectionState.selector === selector
      ? selectionState.value
      : selector(store.getFrame(roverId));

  useEffect(() => {
    const publishSelected = (value) => {
      setSelectionState({ roverId, selector, value });
    };
    return store.subscribeSelector(roverId, selector, publishSelected, equalityFn, { mode, throttleMs });
  }, [equalityFn, mode, roverId, selector, store, throttleMs]);

  return renderedSelected;
}

export function useVisualTelemetrySelector(roverId, selector, equalityFn = Object.is, options = {}) {
  return useTelemetrySelector(roverId, selector, equalityFn, { ...options, mode: 'visual' });
}
