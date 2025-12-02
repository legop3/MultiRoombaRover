import { io } from 'socket.io-client';

const configured = import.meta.env.VITE_ROVERD_URL?.trim();
const resolvedUrl = configured && configured.length > 0 ? configured : window.location.origin;
console.info('[socket] connecting to', resolvedUrl);
export const socket = io(resolvedUrl, {
  transports: ['websocket', 'polling'],
  timeout: 15000,
});
socket.on('connect_error', (err) => console.error('connect_error', err.code, err.message, err.data));
