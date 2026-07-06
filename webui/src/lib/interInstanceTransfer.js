// Inter-Instance Transfer Helpers
// Purpose: Builds cross-server links and moves the local settings cookie only when the user opts in before leaving.
// Scope: Keeps URL encoding and settings-transfer behavior out of the rover queue rendering code.
import { loadSettings } from '../settings/persistence.js';

function base64UrlEncodeJson(value) {
  const json = JSON.stringify(value ?? {});
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecodeJson(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function buildExternalRoverUrl(instance, roverId, { includeSettings = false } = {}) {
  const publicUrl = String(instance?.instance?.publicUrl || instance?.publicUrl || instance?.url || '').trim();
  if (!publicUrl) return '';
  const url = new URL(publicUrl);
  if (roverId) url.searchParams.set('rover', String(roverId));
  /*
    The destination always applies settingsTransfer if present, so this helper
    only adds it after the current page has already asked for consent.
  */
  if (includeSettings) {
    url.searchParams.set('settingsTransfer', base64UrlEncodeJson(loadSettings()));
  }
  return url.toString();
}

export function openExternalRoverWithPrompt(instance, roverId) {
  const withoutTransfer = buildExternalRoverUrl(instance, roverId);
  if (!withoutTransfer) return;
  const instanceName = String(instance?.instance?.name || instance?.url || 'that server');
  const includeSettings = window.confirm(
    `Transfer your identity and settings to ${instanceName}? Press Cancel to open without transferring them.`,
  );
  const targetUrl = buildExternalRoverUrl(instance, roverId, { includeSettings });
  window.location.href = targetUrl || withoutTransfer;
}
