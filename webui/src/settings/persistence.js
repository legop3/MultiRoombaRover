// Settings Persistence
// Purpose: Implements local persistence read/write behavior for settings namespaces. Scope: Encapsulates storage IO, parsing guards, and migration-safe defaults.
import { SETTINGS_COOKIE, SETTINGS_STORAGE_KEY } from './constants.js';

function parseSettings(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to parse settings from ${source}`, error);
    return null;
  }
}

function loadCookieSettings() {
  const cookiePrefix = `${SETTINGS_COOKIE}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix));
  if (!entry) return null;

  const raw = entry.substring(cookiePrefix.length);
  try {
    return parseSettings(decodeURIComponent(raw ?? ''), 'cookie');
  } catch (error) {
    // URI decoding can fail before JSON parsing when an old cookie is truncated or corrupt.
    // Treat that cookie as unavailable so it cannot prevent the Web UI from starting cleanly.
    console.warn('Failed to decode settings cookie', error);
    return null;
  }
}

function removeSettingsCookie() {
  // The cookie used path=/, so deletion must use the same path. Removal happens only after
  // localStorage has accepted and verified the migrated value, preserving the recoverable copy
  // when storage is disabled by a browser policy.
  document.cookie = `${SETTINGS_COOKIE}=; path=/; max-age=0; samesite=strict`;
}

export function loadSettings() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return {};

  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored !== null) {
      return parseSettings(stored, 'localStorage') ?? {};
    }
  } catch (error) {
    // Some privacy modes expose localStorage but throw when it is accessed. Continue to the
    // legacy cookie so existing users retain usable settings in those restricted environments.
    console.warn('Failed to read settings from localStorage', error);
    return loadCookieSettings() ?? {};
  }

  const cookieSettings = loadCookieSettings();
  if (cookieSettings === null) return {};

  // This is a one-time migration for browsers that already have roverSettings. Reuse the normal
  // verified writer so the legacy cookie is removed only when the complete value is safely stored.
  if (saveSettings(cookieSettings)) {
    removeSettingsCookie();
  }
  return cookieSettings;
}

export function saveSettings(settings) {
  if (typeof window === 'undefined') return false;

  try {
    const serialized = JSON.stringify(settings ?? {});
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);

    // setItem can be intercepted or fail unusually in embedded/privacy-constrained browsers.
    // Reading the exact value back keeps the provider from claiming success unless persistence
    // really contains the complete settings payload that was just written.
    return window.localStorage.getItem(SETTINGS_STORAGE_KEY) === serialized;
  } catch (error) {
    console.warn('Failed to write settings to localStorage', error);
    return false;
  }
}
