// Analytics Bridge
// Purpose: Gives React a tiny, provider-neutral analytics surface. Scope:
// forwards optional app events to a build-time injected browser adapter without
// importing Umami, embedding website ids, or making rover controls depend on
// analytics availability.

const MAX_EVENT_NAME_LENGTH = 80;
const MAX_PROPERTY_KEY_LENGTH = 80;
const MAX_STRING_VALUE_LENGTH = 240;
const throttledEvents = new Map();

function getAdapter() {
  if (typeof window === 'undefined') return null;
  return window.roverAnalytics && typeof window.roverAnalytics === 'object'
    ? window.roverAnalytics
    : null;
}

function normalizeEventName(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
  return normalized ? normalized.slice(0, MAX_EVENT_NAME_LENGTH) : null;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MAX_STRING_VALUE_LENGTH) : undefined;
  }
  if (Array.isArray(value)) {
    /*
      Analytics properties should stay compact and dashboard-friendly. Arrays
      are reduced to primitive strings instead of sending nested structures that
      Umami cannot use well for event breakdowns.
    */
    const normalized = value
      .map((entry) => normalizeValue(entry))
      .filter((entry) => entry !== undefined)
      .map((entry) => String(entry));
    return normalized.length ? normalized.slice(0, 12).join(',') : undefined;
  }
  return undefined;
}

function normalizePayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return Object.entries(payload).reduce((clean, [key, value]) => {
    if (typeof key !== 'string') return clean;
    const normalizedKey = key.trim().replace(/[^a-zA-Z0-9_:-]+/g, '_').slice(0, MAX_PROPERTY_KEY_LENGTH);
    if (!normalizedKey) return clean;
    const normalizedValue = normalizeValue(value);
    if (normalizedValue === undefined) return clean;
    clean[normalizedKey] = normalizedValue;
    return clean;
  }, {});
}

export function trackAnalyticsEvent(name, payload = {}) {
  const eventName = normalizeEventName(name);
  if (!eventName) return;
  const adapter = getAdapter();
  if (!adapter || typeof adapter.track !== 'function') return;

  try {
    /*
      Analytics must be observability-only. Catching adapter errors here keeps a
      broken or blocked third-party script from interfering with rover driving,
      scanner input, chat, or any other live-control UI.
    */
    adapter.track(eventName, normalizePayload(payload));
  } catch (error) {
    console.warn('Analytics event failed', error);
  }
}

export function identifyAnalyticsSession(payload = {}) {
  const adapter = getAdapter();
  if (!adapter || typeof adapter.identify !== 'function') return;

  try {
    /*
      Session identity is centralized so individual events do not need to repeat
      nickname, rover, role, layout, and route data. The injected build-time
      adapter still decides which fields are forwarded to the actual provider.
    */
    adapter.identify(normalizePayload(payload));
  } catch (error) {
    console.warn('Analytics identify failed', error);
  }
}

export function trackAnalyticsEventThrottled(name, payload = {}, options = {}) {
  const eventName = normalizeEventName(name);
  if (!eventName) return;
  const throttleMs = Number.isFinite(options?.throttleMs) ? Math.max(0, options.throttleMs) : 30 * 1000;
  const key = `${eventName}:${typeof options?.key === 'string' ? options.key : JSON.stringify(normalizePayload(payload))}`;
  const now = Date.now();
  const lastTrackedAt = throttledEvents.get(key) || 0;

  /*
    Reliability signals can repeat every reconnect loop or failed media retry.
    Throttling by a caller-owned key keeps Umami useful as an incident signal
    without turning transient outages into hundreds of duplicate custom events.
  */
  if (now - lastTrackedAt < throttleMs) return;
  throttledEvents.set(key, now);
  trackAnalyticsEvent(eventName, payload);
}
