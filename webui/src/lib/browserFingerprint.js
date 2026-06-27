// Browser Fingerprint
// Purpose: Wraps Thumbmark behind one app-owned helper so identity sync does not
// depend on the third-party package shape throughout the UI.
// Scope: Produces a normalized device fingerprint signal for the server identity service.
import { getFingerprint } from '@thumbmarkjs/thumbmarkjs';

let fingerprintPromise = null;

function normalizeThumbmark(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  /*
    The server treats the prefix as part of the signal format so different
    fingerprint providers can coexist later without hash-space ambiguity.
  */
  const body = raw.startsWith('tm_') ? raw.slice(3) : raw;
  const safeBody = body.replace(/[^a-z0-9_-]/g, '');
  return safeBody ? `tm_${safeBody}` : '';
}

export async function getBrowserFingerprintId() {
  if (typeof window === 'undefined') return '';
  if (!fingerprintPromise) {
    fingerprintPromise = Promise.resolve()
      .then(() => getFingerprint())
      .then(normalizeThumbmark)
      .catch((error) => {
        console.warn('Failed to calculate browser fingerprint', error); // eslint-disable-line no-console
        return '';
      });
  }
  return fingerprintPromise;
}
