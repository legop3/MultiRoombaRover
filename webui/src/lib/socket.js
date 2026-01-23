import { io } from 'socket.io-client';
import { loadSettings } from '../settings/persistence.js';

const configured = import.meta.env.VITE_ROVERD_URL?.trim();
const resolvedUrl = configured && configured.length > 0 ? configured : window.location.origin;
console.info('[socket] connecting to', resolvedUrl);
const settings = loadSettings();
const transportPref = settings?.page?.connectionTransport || 'websocket';
const transports = transportPref === 'polling' ? ['polling'] : ['websocket', 'polling'];
const CLIENT_ID_KEY = 'roverd_client_id';

function getClientId() {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = (crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch (err) {
    return null;
  }
}

const clientId = getClientId();
export const socket = io(resolvedUrl, {
  transports,
  timeout: 15000,
  auth: {
    clientId,
  },
});
socket.on('connect_error', (err) => console.error('connect_error', err.code, err.message, err.data));
