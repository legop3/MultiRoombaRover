import { CONTROL_SETTINGS_COOKIE, CONTROL_SETTINGS_MAX_AGE } from './constants.js';

function parseCookieValue(raw) {
  try {
    const decoded = decodeURIComponent(raw ?? '');
    return JSON.parse(decoded);
  } catch (error) {
    console.warn('Failed to parse control settings cookie', error); // eslint-disable-line no-console
    return null;
  }
}

export function loadControlSettings() {
  if (typeof document === 'undefined') return null;
  const cookiePrefix = `${CONTROL_SETTINGS_COOKIE}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix));
  if (!entry) return null;
  const raw = entry.substring(cookiePrefix.length);
  return parseCookieValue(raw);
}

export function saveControlSettings(settings) {
  if (typeof document === 'undefined') return false;
  try {
    const serialized = encodeURIComponent(JSON.stringify(settings ?? {}));
    const cookie = `${CONTROL_SETTINGS_COOKIE}=${serialized}; path=/; max-age=${CONTROL_SETTINGS_MAX_AGE}; samesite=strict`;
    document.cookie = cookie;
    return true;
  } catch (error) {
    console.warn('Failed to write control settings cookie', error); // eslint-disable-line no-console
    return false;
  }
}
