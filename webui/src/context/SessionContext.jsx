/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocket } from './SocketContext.jsx';

const SessionContext = createContext({
  connected: false,
  session: null,
  logs: [],
  adminLogs: [],
  llmCommentaryState: null,
  llmCommentaryStatus: null,
  login: async () => {},
  setRole: async () => {},
  requestControl: async () => {},
  releaseControl: async () => {},
  subscribeAll: async () => {},
  homeAssistantToggle: async () => {},
  homeAssistantSetState: async () => {},
  homeAssistantSetLightColor: async () => {},
  setNickname: async () => {},
  triggerReplay: async () => {},
  setCommunityGoal: async () => {},
  setAdminReason: async () => {},
  rebootRover: async () => {},
  rebootServer: async () => {},
  llmControl: async () => {},
});

function useAckEmitter(socket) {
  return useCallback(
    (event, payload = {}) =>
      new Promise((resolve, reject) => {
        socket.emit(event, payload, (resp = {}) => {
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp);
          }
        });
      }),
    [socket],
  );
}

export function SessionProvider({ children }) {
  const socket = useSocket();
  const emitWithAck = useAckEmitter(socket);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [llmCommentaryState, setLlmCommentaryState] = useState(null);
  const [llmCommentaryStatus, setLlmCommentaryStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    function handleSession(payload) {
      setSession(payload);
    }
    function handleLogInit(entries = []) {
      setLogs(entries);
    }
    function handleLogEntry(entry) {
      setLogs((prev) => [...prev.slice(-199), entry]);
    }
    function handleAdminLogInit(entries = []) {
      setAdminLogs(entries);
    }
    function handleAdminLogEntry(entry) {
      setAdminLogs((prev) => [...prev.slice(-199), entry]);
    }
    function handleLlmState(payload = null) {
      const state = payload && typeof payload === 'object' ? payload : null;
      const nextStatus =
        state?.debug?.status && typeof state.debug.status === 'object' ? state.debug.status : null;
      setLlmCommentaryState(state);
      setLlmCommentaryStatus(nextStatus);
    }
    socket.on('session:sync', handleSession);
    socket.on('log:init', handleLogInit);
    socket.on('log:entry', handleLogEntry);
    socket.on('adminlog:init', handleAdminLogInit);
    socket.on('adminlog:entry', handleAdminLogEntry);
    socket.on('llm:state', handleLlmState);
    socket.on('alert:new', (payload = {}) => {
      setAlerts((prev) => [
        ...prev.slice(-49),
        {
          ...payload,
          receivedAt: Date.now(),
        },
      ]);
    });
    return () => {
      socket.off('session:sync', handleSession);
      socket.off('log:init', handleLogInit);
      socket.off('log:entry', handleLogEntry);
      socket.off('adminlog:init', handleAdminLogInit);
      socket.off('adminlog:entry', handleAdminLogEntry);
      socket.off('llm:state', handleLlmState);
      socket.off('alert:new');
    };
  }, [socket]);

  const actions = useMemo(
    () => ({
      login: (username, password) => emitWithAck('auth:login', { username, password }),
      setRole: (role) => emitWithAck('session:setRole', { role }),
      requestControl: (roverId, options = {}) =>
        emitWithAck('session:requestControl', { roverId, ...options }),
      releaseControl: (roverId) => emitWithAck('session:releaseControl', { roverId }),
      subscribeAll: () => emitWithAck('session:subscribeAll'),
      lockRover: (roverId, locked) => emitWithAck('session:lockRover', { roverId, locked }),
      setMode: (mode) => emitWithAck('setMode', { mode }),
      homeAssistantToggle: (entityId) => emitWithAck('homeAssistant:toggle', { entityId }),
      homeAssistantSetState: (entityId, state) =>
        emitWithAck('homeAssistant:setState', { entityId, state }),
      homeAssistantSetLightColor: (entityId, rgbColor) =>
        emitWithAck('homeAssistant:lightColor', { entityId, rgbColor }),
      setNickname: (nickname) => emitWithAck('nickname:set', { nickname }),
      triggerReplay: (sources = []) => emitWithAck('replay:trigger', { sources }),
      setCommunityGoal: (text) => emitWithAck('communityGoal:set', { text }),
      setAdminReason: (text) => emitWithAck('adminReason:set', { text }),
      rebootRover: (roverId) =>
        emitWithAck('command', { roverId, type: 'reboot', data: { reboot: {} } }),
      rebootServer: () => emitWithAck('server:reboot'),
      llmControl: (action, controls = {}) =>
        emitWithAck('llm:control', { controls: { action, ...controls } }),
      pushAlert: (alert) =>
        setAlerts((prev) => [
          ...prev.slice(-49),
          { ...alert, receivedAt: Date.now(), id: alert.id || Math.random().toString(36).slice(2) },
        ]),
    }),
    [emitWithAck],
  );

  const value = useMemo(
    () => ({
      connected,
      session,
      logs,
      adminLogs,
      llmCommentaryState,
      llmCommentaryStatus,
      alerts,
      ...actions,
    }),
    [actions, adminLogs, alerts, connected, llmCommentaryState, llmCommentaryStatus, logs, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
