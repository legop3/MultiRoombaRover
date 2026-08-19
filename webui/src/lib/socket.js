// Socket Library Helper
// Purpose: Builds and exports the browser Socket.IO client with shared defaults. Scope: Centralizes connection URL/options so all modules use consistent socket behavior.
import { io } from 'socket.io-client';
import { getBrowserFingerprintId } from './browserFingerprint.js';
import { loadSettings } from '../settings/persistence.js';

const configured = import.meta.env.VITE_ROVERD_URL?.trim();
const resolvedUrl = configured && configured.length > 0 ? configured : window.location.origin;
console.info('[socket] connecting to', resolvedUrl);
const settings = loadSettings();
const transportPref = settings?.page?.connectionTransport || 'websocket';
const transports = transportPref === 'polling' ? ['polling'] : ['websocket', 'polling'];

function getIdentitySurface() {
  /*
    Duplicate-driver protection is connection-specific, so the route must be
    known during the handshake rather than waiting for a React route component
    to mount. The main driver and dedicated PTZ controller are the two active
    control surfaces; every other route is passive identity-wise.
  */
  return window.location.pathname === '/'
    || window.location.pathname === '/old'
    || window.location.pathname === '/ptz'
    ? 'driver'
    : 'passive';
}

async function buildSocketIdentity() {
  /*
    Socket.IO invokes this auth callback again for every reconnection. Reading
    persistence here, instead of reusing the module-level settings snapshot,
    ensures that nickname, preferences, imported settings, and a server-issued
    identity key are current whenever a new socket is accepted.
  */
  const currentSettings = loadSettings();
  const fingerprintId = await getBrowserFingerprintId();
  return {
    cookieUserId: String(currentSettings?.identity?.cookieUserId || '').trim(),
    fingerprintId,
    nickname: String(currentSettings?.profile?.nickname || '').trim(),
    // Signed percentages are harmless browser preferences. The server resolves
    // identity first, then enforces permission and range before rover output.
    audioAdjustments: currentSettings?.audioAdjustments || {},
    overseerEnabled: Boolean(currentSettings?.overseerPreference?.enabled),
    identitySurface: getIdentitySurface(),
  };
}

export const socket = io(resolvedUrl, {
  transports,
  timeout: 15000,
  /*
    The callback form lets the existing asynchronous fingerprint finish before
    Socket.IO sends its namespace CONNECT packet. Server connection middleware
    can therefore attach the canonical identity before any feature service sees
    the socket, eliminating the previous connected-but-unidentified window.
  */
  auth: (callback) => {
    buildSocketIdentity().then(callback);
  },
});
socket.on('connect_error', (err) => console.error('connect_error', err.code, err.message, err.data));
