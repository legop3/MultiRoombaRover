import { io } from "socket.io-client";

console.log('socket.io client loaded')

const serverUrl = import.meta.env.VITE_ROVERD_URL ?? "http://localhost:8080";
export const socket = io({
// export const socket = io(serverUrl, {
  transports: ["websocket"], // skip polling if your backend supports it
  query: {
    role: "user"
  }
});
