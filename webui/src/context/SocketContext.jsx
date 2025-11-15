// src/context/SocketContext.jsx
import { createContext, useContext } from "react";
import { socket } from "../lib/socket";

const SocketContext = createContext(socket);
export const SocketProvider = ({ children }) => (
  <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
);
export const useSocket = () => useContext(SocketContext);
