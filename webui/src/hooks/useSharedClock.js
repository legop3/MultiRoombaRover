// Shared Clock Hook
// Purpose: Lets display-only countdown components share one browser interval per cadence.
// Scope: Keeps timers out of control/safety paths; callers opt in only for UI text that can tolerate coarse updates.
import { useEffect, useState } from 'react';

const clockStores = new Map();

function nowMs() {
  return Date.now();
}

function normalizeDelay(delayMs) {
  const delay = Number(delayMs);
  if (!Number.isFinite(delay) || delay <= 0) return 1000;
  return Math.max(16, Math.round(delay));
}

function getStore(delayMs) {
  const delay = normalizeDelay(delayMs);
  const existing = clockStores.get(delay);
  if (existing) return existing;

  const store = {
    delay,
    timer: null,
    visibilityHandler: null,
    current: nowMs(),
    listeners: new Set(),
  };
  clockStores.set(delay, store);
  return store;
}

function stopStore(store) {
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
  if (store.visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', store.visibilityHandler);
    store.visibilityHandler = null;
  }
}

function publish(store) {
  store.current = nowMs();
  store.listeners.forEach((listener) => listener(store.current));
}

function ensureVisibilityHandler(store) {
  if (store.visibilityHandler || typeof document === 'undefined') return;
  store.visibilityHandler = () => {
    if (!store.listeners.size) return;
    if (document.visibilityState === 'visible') {
      /*
        Hidden tabs do not need display-only countdown work. When the tab comes
        back, publish immediately so labels catch up before the next interval.
      */
      publish(store);
      startStore(store);
      return;
    }
    if (store.timer) {
      clearInterval(store.timer);
      store.timer = null;
    }
  };
  document.addEventListener('visibilitychange', store.visibilityHandler);
}

function startStore(store) {
  if (store.timer || !store.listeners.size) return;
  ensureVisibilityHandler(store);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  /*
    One interval fans out to every mounted consumer using the same cadence. The
    previous pattern created independent intervals in each countdown component,
    which meant several panels could wake the main thread separately even though
    they only needed the same "current time" value for human-readable labels.
  */
  store.timer = setInterval(() => {
    publish(store);
  }, store.delay);
}

function subscribe(store, listener) {
  store.listeners.add(listener);
  startStore(store);

  return () => {
    store.listeners.delete(listener);
    /*
      Stop the interval as soon as the last consumer leaves. This matters for
      tab panels and overlays because hidden or unmounted UI should not keep a
      display clock alive just because another render path created it earlier.
    */
    if (!store.listeners.size) {
      stopStore(store);
    }
  };
}

export function useSharedClock(delayMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => nowMs());

  useEffect(() => {
    if (!enabled) return undefined;
    const store = getStore(delayMs);
    /*
      Subscribing starts the shared interval but does not synchronously push
      state from inside the effect. React's newer lint rules flag synchronous
      effect-time state writes because they can cascade renders; the hook's
      initial Date.now state is already fresh for the first paint, and later
      updates arrive through the interval or visibility callback.
    */
    return subscribe(store, setNow);
  }, [delayMs, enabled]);

  return now;
}
