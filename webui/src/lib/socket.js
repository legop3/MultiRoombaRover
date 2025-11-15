import { io } from 'socket.io-client';

const configuredUrl = import.meta.env.VITE_ROVERD_URL?.trim();
const serverUrl = configuredUrl && configuredUrl.length > 0 ? configuredUrl : undefined;

export const socket = io(serverUrl, {
  transports: ['websocket', 'polling'],
  timeout: 15000,
  reconnectionAttempts: 5,
  query: { role: 'user' },
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error.message);
});
