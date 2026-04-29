// Socket Library Helper
// Purpose: Builds and exports the browser Socket.IO client with shared defaults. Scope: Centralizes connection URL/options so all modules use consistent socket behavior.
import { io } from 'socket.io-client';
import { loadSettings } from '../settings/persistence.js';

const configured = import.meta.env.VITE_ROVERD_URL?.trim();
const resolvedUrl = configured && configured.length > 0 ? configured : window.location.origin;
console.info('[socket] connecting to', resolvedUrl);
const settings = loadSettings();
const transportPref = settings?.page?.connectionTransport || 'websocket';
const transports = transportPref === 'polling' ? ['polling'] : ['websocket', 'polling'];
export const socket = io(resolvedUrl, {
  transports,
  timeout: 15000,
});
socket.on('connect_error', (err) => console.error('connect_error', err.code, err.message, err.data));
