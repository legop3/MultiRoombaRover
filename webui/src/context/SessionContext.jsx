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
  overseerControlState: null,
  overseerMemory: null,
  alerts: [],
  replayJobs: {},
  latestReplay: null,
  latestRequestedReplay: null,
  duplicateIdentityBlock: null,
  roverRemovalNotice: null,
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

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shareUnchangedTree(previous, next) {
  if (Object.is(previous, next)) return previous;

  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) {
      // Different lengths mean the array shape changed. We still reconcile each
      // shared index because unchanged entries should keep their identity even
      // when siblings are added or removed.
      return next.map((value, idx) => shareUnchangedTree(previous[idx], value));
    }

    let changed = false;
    const reconciled = next.map((value, idx) => {
      const sharedValue = shareUnchangedTree(previous[idx], value);
      if (sharedValue !== previous[idx]) changed = true;
      return sharedValue;
    });

    // Returning the previous array is the key optimization: selectors that read
    // this slice use Object.is by default, so preserving the array reference
    // prevents subscribers from updating when the server sent equivalent data.
    return changed ? reconciled : previous;
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    const sameKeyCount = previousKeys.length === nextKeys.length;
    let changed = !sameKeyCount;
    const reconciled = {};

    for (const key of nextKeys) {
      const hadKey = Object.prototype.hasOwnProperty.call(previous, key);
      const sharedValue = shareUnchangedTree(previous[key], next[key]);
      reconciled[key] = sharedValue;

      // A new key or a different child reference means this object must get a
      // new reference, but unchanged child objects are still reused. This keeps
      // updates precise without hardcoding any knowledge of session fields.
      if (!hadKey || sharedValue !== previous[key]) {
        changed = true;
      }
    }

    return changed ? reconciled : previous;
  }

  // Socket payloads should be JSON-shaped, but primitives and any non-plain
  // objects that reach this helper are safest treated as replace-by-value. That
  // avoids accidentally reusing mutable class instances or browser objects.
  return next;
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
      setState((prev) => {
        const nextSession = shareUnchangedTree(prev.session, payload);

        // If the server sync is equivalent to the current session tree, keep the
        // entire app state reference. That skips the subscriber loop completely
        // instead of relying on each component to reject no-op updates itself.
        return nextSession === prev.session ? prev : { ...prev, session: nextSession };
      });
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
    function handleReplayStatus(payload = {}) {
      if (!payload?.jobId) return;
      setState((prev) => {
        const previous = prev.replayJobs?.[payload.jobId] || {};
        const nextJob = {
          ...previous,
          ...payload,
          updatedAt: Date.now(),
        };
        return {
          ...prev,
          // Keep status by job id because the replay panel receives the job id synchronously
          // from the trigger acknowledgement, then later socket events update that same record.
          replayJobs: {
            ...(prev.replayJobs || {}),
            [payload.jobId]: nextJob,
          },
        };
      });
    }
    function handleReplayReady(payload = {}) {
      if (!payload?.jobId || !payload?.url) return;
      setState((prev) => {
        const previous = prev.replayJobs?.[payload.jobId] || {};
        const selfSocketId = String(prev.session?.socketId || '').trim();
        const requesterSocketId = String(payload?.requestedBy?.socketId || '').trim();
        const requestedByThisBrowser = Boolean(selfSocketId && requesterSocketId && selfSocketId === requesterSocketId);
        const nextJob = {
          ...previous,
          ...payload,
          status: 'ready',
          media: payload,
          updatedAt: Date.now(),
        };
        return {
          ...prev,
          replayJobs: {
            ...(prev.replayJobs || {}),
            [payload.jobId]: nextJob,
          },
          // Only the latest replay media is retained. Discord is the media host, so
          // this state is intentionally short-lived and does not become a replay library.
          latestReplay: {
            ...payload,
            receivedAt: Date.now(),
          },
          latestRequestedReplay: requestedByThisBrowser
            ? {
                ...payload,
                receivedAt: Date.now(),
              }
            : prev.latestRequestedReplay,
        };
      });
    }
    function handleReplayFailed(payload = {}) {
      if (payload?.jobId) handleReplayStatus({ ...payload, status: 'failed' });
      const message = typeof payload?.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'Replay failed after being accepted.';
      setState((prev) => ({
        ...prev,
        alerts: [
          ...prev.alerts.slice(-49),
          {
            id: payload?.jobId ? `replay-failed-${payload.jobId}` : `replay-failed-${Date.now()}`,
            title: 'Replay failed',
            message,
            color: '#f59e0b',
            receivedAt: Date.now(),
            lifetimeMs: 6000,
          },
        ],
      }));
    }
    function handleOverseerState(payload = null) {
      const state = payload && typeof payload === 'object' ? payload : null;
      setState((prev) => ({ ...prev, overseerControlState: state }));
    }
    function handleOverseerMemory(payload = null) {
      // Overseer memory is intentionally stored separately from session sync so
      // the vote panel can refresh as soon as the overseer writes memory.
      const memory = payload && typeof payload === 'object' ? payload : null;
      setState((prev) => ({ ...prev, overseerMemory: memory }));
    }
    function handleDuplicateIdentity(payload = {}) {
      /*
        The server sends this event immediately before closing an older duplicate
        tab. Persisting the reason in app state lets the UI replace the whole
        page with a clear blocking screen instead of leaving users on a normal
        disconnected interface that looks recoverable.
      */
      const message =
        typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : 'This driver session is already active in another tab.';
      setState((prev) => ({
        ...prev,
        duplicateIdentityBlock: {
          ...payload,
          message,
          receivedAt: Date.now(),
        },
      }));
    }
    function handleRoverRemovalNotice(payload = {}) {
      /*
        Removal reasons arrive as socket events because the next normal session
        sync only says "not assigned". Keeping the explanation outside the
        session tree lets the no-rover video panel tell the user why control was
        removed after admin, safety, or idle-removal actions.
      */
      const message =
        typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : 'You were removed from the rover.';
      const title =
        typeof payload?.title === 'string' && payload.title.trim()
          ? payload.title.trim()
          : 'Removed from rover';
      setState((prev) => ({
        ...prev,
        roverRemovalNotice: {
          ...payload,
          title,
          message,
          receivedAt: Date.now(),
        },
      }));
    }
    socket.on('session:sync', handleSession);
    socket.on('log:init', handleLogInit);
    socket.on('log:entry', handleLogEntry);
    socket.on('adminlog:init', handleAdminLogInit);
    socket.on('adminlog:entry', handleAdminLogEntry);
    socket.on('llm:state', handleLlmState);
    socket.on('overseer:state', handleOverseerState);
    socket.on('overseer:memory', handleOverseerMemory);
    socket.on('alert:new', handleAlertNew);
    socket.on('replay:status', handleReplayStatus);
    socket.on('replay:ready', handleReplayReady);
    socket.on('replay:failed', handleReplayFailed);
    socket.on('session:duplicateIdentity', handleDuplicateIdentity);
    socket.on('session:roverRemovalNotice', handleRoverRemovalNotice);
    return () => {
      socket.off('session:sync', handleSession);
      socket.off('log:init', handleLogInit);
      socket.off('log:entry', handleLogEntry);
      socket.off('adminlog:init', handleAdminLogInit);
      socket.off('adminlog:entry', handleAdminLogEntry);
      socket.off('llm:state', handleLlmState);
      socket.off('overseer:state', handleOverseerState);
      socket.off('overseer:memory', handleOverseerMemory);
      socket.off('alert:new', handleAlertNew);
      socket.off('replay:status', handleReplayStatus);
      socket.off('replay:ready', handleReplayReady);
      socket.off('replay:failed', handleReplayFailed);
      socket.off('session:duplicateIdentity', handleDuplicateIdentity);
      socket.off('session:roverRemovalNotice', handleRoverRemovalNotice);
    };
  }, [setState, socket]);

  const actions = useMemo(
    () => ({
      login: (username, password) => emitWithAck('auth:login', { username, password }),
      identifySession: ({ cookieUserId, fingerprintId, nickname, overseerEnabled, identitySurface } = {}) =>
        emitWithAck('session:identify', { cookieUserId, fingerprintId, nickname, overseerEnabled, identitySurface }),
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
      // The browser deals in CSS-friendly hex strings; the server converts that
      // to Home Assistant's rgb_color service payload.
      homeAssistantSetLightColor: (entityId, colorHex) =>
        emitWithAck('homeAssistant:lightColor', { entityId, colorHex }),
      homeAssistantSetLightWhite: (entityId) =>
        emitWithAck('homeAssistant:lightWhite', { entityId }),
      neatoStart: () => emitWithAck('neato:start'),
      neatoSendHome: () => emitWithAck('neato:sendHome'),
      neatoLocate: () => emitWithAck('neato:locate'),
      neatoClearErrors: () => emitWithAck('neato:clearErrors'),
      neatoPowerCycle: () => emitWithAck('neato:powerCycle'),
      liftUp: () => emitWithAck('lift:up'),
      liftDown: () => emitWithAck('lift:down'),
      setNickname: (nickname) => emitWithAck('nickname:set', { nickname }),
      requestVerification: () => emitWithAck('verification:request'),
      requestPrivateRoverAccess: (roverId) =>
        emitWithAck('session:privateRover:requestAccess', { roverId }),
      rebootOwnRover: () => emitWithAck('session:rebootOwnRover'),
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
      // Rover updates are intentionally parameter-free from the browser. The Pi
      // side owns the git pull + installer sequence so the admin UI can request
      // maintenance without becoming a remote shell.
      updateRover: (roverId) =>
        emitWithAck('command', { roverId, type: 'update', data: { update: {} } }),
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
      overseerControl: (action, controls = {}) =>
        emitWithAck('overseer:control', { controls: { action, ...controls } }),
      pushAlert: (alert) =>
        setState((prev) => ({
          ...prev,
          alerts: [
            ...prev.alerts.slice(-49),
            { ...alert, receivedAt: Date.now(), id: alert.id || Math.random().toString(36).slice(2) },
          ],
        })),
      clearLatestReplay: () =>
        setState((prev) => (prev.latestReplay ? { ...prev, latestReplay: null } : prev)),
      showReplayModal: (replay) =>
        setState((prev) => ({
          ...prev,
          latestRequestedReplay: replay ? { ...replay, receivedAt: Date.now() } : null,
        })),
      clearReplayModal: () =>
        setState((prev) => (prev.latestRequestedReplay ? { ...prev, latestRequestedReplay: null } : prev)),
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
  const equalityRef = useRef(equalityFn);

  const [selected, setSelected] = useState(() => selector(store.getState()));

  useEffect(() => {
    // Selectors are often passed inline, so the subscription callback needs to
    // read the latest selector/equality pair without tearing down and rebuilding
    // the subscription on every render. Updating refs after commit satisfies
    // React's purity rules while preserving the existing stable subscription.
    selectorRef.current = selector;
    equalityRef.current = equalityFn;
  });

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
