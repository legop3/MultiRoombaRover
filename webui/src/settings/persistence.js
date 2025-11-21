import { SETTINGS_COOKIE, SETTINGS_MAX_AGE } from './constants.js';

function parseCookieValue(raw) {
  try {
    const decoded = decodeURIComponent(raw ?? '');
    return JSON.parse(decoded);
  } catch (error) {
    console.warn('Failed to parse settings cookie', error); // eslint-disable-line no-console
    return null;
  }
}

export function loadSettings() {
  if (typeof document === 'undefined') return {};
  const cookiePrefix = `${SETTINGS_COOKIE}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix));
  if (!entry) return {};
  const raw = entry.substring(cookiePrefix.length);
  return parseCookieValue(raw) ?? {};
}

export function saveSettings(settings) {
  if (typeof document === 'undefined') return false;
  try {
    const serialized = encodeURIComponent(JSON.stringify(settings ?? {}));
    const cookie = `${SETTINGS_COOKIE}=${serialized}; path=/; max-age=${SETTINGS_MAX_AGE}; samesite=strict`;
    document.cookie = cookie;
    return true;
  } catch (error) {
    console.warn('Failed to write settings cookie', error); // eslint-disable-line no-console
    return false;
  }
}