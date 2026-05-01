// Session Context Provider
// Purpose: Tracks user session identity, roles, queue state, and control assignment data. Scope: Supplies synchronized session state and update hooks to the UI tree.
/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext.jsx';

const INITIAL_STATE = {
  connected: false,
  session: null,
  logs: [],
  adminLogs: [],
  llmCommentaryState: null,
  llmCommentaryStatus: null,
  alerts: [],
};

const SessionContext = createContext(null);

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

function normalizeSelector(selector) {
  return typeof selector === 'function' ? selector : (state) => state;
}

export function SessionProvider({ children }) {
  const socket = useSocket();
  const emitWithAck = useAckEmitter(socket);
  const stateRef = useRef({ ...INITIAL_STATE, connected: socket.connected });
  const subscribersRef = useRef(new Set());

  const getState = useCallback(() => stateRef.current, []);

  const setState = useCallback((updater) => {
    const prev = stateRef.current;
    const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...(updater || {}) };
    if (next === prev) return;
    stateRef.current = next;

    subscribersRef.current.forEach((sub) => {
      const nextSelected = sub.selector(next);
      if (!sub.equalityFn(sub.current, nextSelected)) {
        sub.current = nextSelected;
        sub.listener(nextSelected);
      }
    });
  }, []);

  const subscribe = useCallback((selector, listener, equalityFn = Object.is) => {
    const normalizedSelector = normalizeSelector(selector);
    const sub = {
      selector: normalizedSelector,
      equalityFn,
      listener,
      current: normalizedSelector(stateRef.current),
    };
    subscribersRef.current.add(sub);
    return () => {
      subscribersRef.current.delete(sub);
    };
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setState((prev) => (prev.connected ? prev : { ...prev, connected: true }));
    };
    const onDisconnect = () => {
      setState((prev) => (prev.connected ? { ...prev, connected: false } : prev));
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [setState, socket]);

  useEffect(() => {
    function handleSession(payload) {
      setState((prev) => ({ ...prev, session: payload }));
    }
    function handleLogInit(entries = []) {
      setState((prev) => ({ ...prev, logs: entries }));
    }
    function handleLogEntry(entry) {
      setState((prev) => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
    }
    function handleAdminLogInit(entries = []) {
      setState((prev) => ({ ...prev, adminLogs: entries }));
    }
    function handleAdminLogEntry(entry) {
      setState((prev) => ({ ...prev, adminLogs: [...prev.adminLogs.slice(-199), entry] }));
    }
    function handleLlmState(payload = null) {
      const state = payload && typeof payload === 'object' ? payload : null;
      const nextStatus =
        state?.debug?.status && typeof state.debug.status === 'object' ? state.debug.status : null;
      setState((prev) => ({
        ...prev,
        llmCommentaryState: state,
        llmCommentaryStatus: nextStatus,
      }));
    }
    function handleAlertNew(payload = {}) {
      setState((prev) => ({
        ...prev,
        alerts: [
          ...prev.alerts.slice(-49),
          {
            ...payload,
            receivedAt: Date.now(),
          },
        ],
      }));
    }

    socket.on('session:sync', handleSession);
    socket.on('log:init', handleLogInit);
    socket.on('log:entry', handleLogEntry);
    socket.on('adminlog:init', handleAdminLogInit);
    socket.on('adminlog:entry', handleAdminLogEntry);
    socket.on('llm:state', handleLlmState);
    socket.on('alert:new', handleAlertNew);
    return () => {
      socket.off('session:sync', handleSession);
      socket.off('log:init', handleLogInit);
      socket.off('log:entry', handleLogEntry);
      socket.off('adminlog:init', handleAdminLogInit);
      socket.off('adminlog:entry', handleAdminLogEntry);
      socket.off('llm:state', handleLlmState);
      socket.off('alert:new', handleAlertNew);
    };
  }, [setState, socket]);

  const actions = useMemo(
    () => ({
      login: (username, password) => emitWithAck('auth:login', { username, password }),
      identifySession: ({ cookieUserId, nickname } = {}) =>
        emitWithAck('session:identify', { cookieUserId, nickname }),
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
      homeAssistantSetLightWhite: (entityId) =>
        emitWithAck('homeAssistant:lightWhite', { entityId }),
      neatoStart: () => emitWithAck('neato:start'),
      neatoSendHome: () => emitWithAck('neato:sendHome'),
      neatoLocate: () => emitWithAck('neato:locate'),
      neatoClearErrors: () => emitWithAck('neato:clearErrors'),
      liftUp: () => emitWithAck('lift:up'),
      liftDown: () => emitWithAck('lift:down'),
      setNickname: (nickname) => emitWithAck('nickname:set', { nickname }),
      requestVerification: () => emitWithAck('verification:request'),
      requestPrivateRoverAccess: (roverId) =>
        emitWithAck('session:privateRover:requestAccess', { roverId }),
      triggerReplay: (sourcesOrPayload = [], title = '') => {
        if (sourcesOrPayload && typeof sourcesOrPayload === 'object' && !Array.isArray(sourcesOrPayload)) {
          return emitWithAck('replay:trigger', sourcesOrPayload);
        }
        return emitWithAck('replay:trigger', { sources: sourcesOrPayload, title });
      },
      setGlobalObjective: (text) => emitWithAck('globalObjective:set', { text }),
      setAdminReason: (text) => emitWithAck('adminReason:set', { text }),
      rebootRover: (roverId) =>
        emitWithAck('command', { roverId, type: 'reboot', data: { reboot: {} } }),
      rebootServer: () => emitWithAck('server:reboot'),
      playUploadedAudio: ({ roverId, name, mime, dataBase64 }) =>
        emitWithAck('audio:uploadPlay', { roverId, name, mime, dataBase64 }),
      stopUploadedAudio: (roverId) => emitWithAck('audio:uploadStop', { roverId }),
      startMicWhip: (roverId) => emitWithAck('audio:micWhipStart', { roverId }),
      readyMicWhip: (roverId) => emitWithAck('audio:micWhipReady', { roverId }),
      stopMicWhip: (roverId) => emitWithAck('audio:micWhipStop', { roverId }),
      setAudioLevels: (levels = {}) => emitWithAck('audioLevels:set', levels),
      setPrivateSafety: (roverId, safety = {}) =>
        emitWithAck('session:privateSafety:set', { roverId, safety }),
      llmControl: (action, controls = {}) =>
        emitWithAck('llm:control', { controls: { action, ...controls } }),
      pushAlert: (alert) =>
        setState((prev) => ({
          ...prev,
          alerts: [
            ...prev.alerts.slice(-49),
            { ...alert, receivedAt: Date.now(), id: alert.id || Math.random().toString(36).slice(2) },
          ],
        })),
    }),
    [emitWithAck, setState],
  );

  const store = useMemo(
    () => ({
      getState,
      subscribe,
      actions,
    }),
    [actions, getState, subscribe],
  );

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSessionSelector(selector, equalityFn = Object.is) {
  const store = useContext(SessionContext);
  if (!store) {
    throw new Error('useSessionSelector must be used within SessionProvider');
  }
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalityRef = useRef(equalityFn);
  equalityRef.current = equalityFn;

  const [selected, setSelected] = useState(() => selector(store.getState()));

  useEffect(() => {
    setSelected((prev) => {
      const next = selectorRef.current(store.getState());
      return equalityRef.current(prev, next) ? prev : next;
    });

    return store.subscribe(
      (state) => selectorRef.current(state),
      (nextSelected) => {
        setSelected((prev) => (equalityRef.current(prev, nextSelected) ? prev : nextSelected));
      },
      (a, b) => equalityRef.current(a, b),
    );
  }, [store]);

  return selected;
}

export function useSessionActions() {
  const store = useContext(SessionContext);
  if (!store) {
    throw new Error('useSessionActions must be used within SessionProvider');
  }
  return store.actions;
}

export function useSession() {
  const state = useSessionSelector((value) => value);
  const actions = useSessionActions();
  return useMemo(() => ({ ...state, ...actions }), [actions, state]);
}
