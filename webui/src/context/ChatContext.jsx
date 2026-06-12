// Chat Context Provider
// Purpose: Maintains global chat message state, posting helpers, and typing indicators. Scope: Provides chat event subscriptions and mutation actions for chat-capable components.
/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useSessionActions, useSessionSelector } from './SessionContext.jsx';
import messageSound from '../assets/message.mp3';
import { useSettingsNamespace } from '../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../settings/namespaces.js';

const CHAT_TIMELINE_DEFAULT = {
  messages: [],
  typing: [],
};

const CHAT_ACTIONS_DEFAULT = {
  sendMessage: async () => {},
  focusChat: () => {},
  blurChat: () => {},
  registerInputRef: () => {},
  onInputFocus: () => {},
  onInputBlur: () => {},
  setTypingActive: () => {},
};

const CHAT_FOCUS_DEFAULT = {
  isChatFocused: false,
  selfSocketId: null,
};

// Chat messages and typing indicators are the highest-churn chat data. Keeping
// them in their own context lets transcript components update without forcing
// controlled composer inputs to re-render and re-commit unchanged attributes.
const ChatTimelineContext = createContext(CHAT_TIMELINE_DEFAULT);

// Actions are intentionally separate from timeline state. Consumers such as the
// HUD composer only need stable command functions, so subscribing them to the
// message array would recreate the performance issue this provider is avoiding.
const ChatActionsContext = createContext(CHAT_ACTIONS_DEFAULT);

// Focus state is used by keyboard input capture. It changes for input focus and
// blur events, but it should not be tied to incoming chat traffic either.
const ChatFocusContext = createContext(CHAT_FOCUS_DEFAULT);

const ChatContext = createContext({
  ...CHAT_TIMELINE_DEFAULT,
  ...CHAT_ACTIONS_DEFAULT,
  ...CHAT_FOCUS_DEFAULT,
});

export function ChatProvider({ children }) {
  const socket = useSocket();
  const session = useSessionSelector((state) => state.session);
  const { pushAlert } = useSessionActions();
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const { value: profileSettings } = useSettingsNamespace('profile', { nickname: '', profileImageUrl: '' });
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState([]);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const panelInputRef = useRef(null);
  const hudInputRef = useRef(null);
  const audioRef = useRef(null);
  const typingRef = useRef(new Map());
  const typingAlertRef = useRef(new Map());
  const typingStateRef = useRef({ isTyping: false, lastSent: 0 });
  const masterVolume = Number.isFinite(audioSettings?.masterVolume) ? audioSettings.masterVolume : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const alertVolume = Number.isFinite(audioSettings?.alertVolume) ? audioSettings.alertVolume : AUDIO_SETTINGS_DEFAULTS.alertVolume;
  const effectiveAlertVolume = Math.max(0, Math.min(1, masterVolume * alertVolume));
  const isVerified = Boolean(session?.isVerified);
  const profileImage = isVerified ? String(profileSettings?.profileImageUrl || '').trim() : '';

  const rebuildTyping = useCallback(() => {
    const entries = Array.from(typingRef.current.values())
      .sort((a, b) => a.lastUpdate - b.lastUpdate)
      .map((entry) => entry.payload);
    setTyping(entries);
  }, []);

  const resolveTypingKey = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.typingId) return payload.typingId;
    if (payload.fromDiscord) {
      return `discord:${payload.discordUserId || payload.discordUserName || payload.nickname || 'unknown'}`;
    }
    return `socket:${payload.socketId || payload.nickname || 'unknown'}`;
  }, []);

  useEffect(() => {
    audioRef.current = new Audio(messageSound);
    audioRef.current.volume = effectiveAlertVolume;
    audioRef.current.load();
  }, [effectiveAlertVolume]);

  const playSound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = effectiveAlertVolume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [effectiveAlertVolume]);

  useEffect(() => {
    function handleMessage(payload = {}) {
      setMessages((prev) => [...prev.slice(-99), payload]);
      if (payload?.socketId && session?.socketId && payload.socketId === session.socketId) {
        return;
      }
      playSound();
      pushAlert?.({
        kind: 'chat',
        payload,
        id: `chat-${payload.id || Math.random().toString(36).slice(2)}`,
        receivedAt: Date.now(),
      });
    }
    socket.on('chat:message', handleMessage);
    return () => {
      socket.off('chat:message', handleMessage);
    };
  }, [playSound, pushAlert, session?.socketId, socket]);

  useEffect(() => {
    function handleTyping(payload = {}) {
      const key = resolveTypingKey(payload);
      if (!key) return;
      const now = Date.now();
      if (payload?.socketId && session?.socketId && payload.socketId === session.socketId) {
        if (!payload.isTyping) {
          typingRef.current.delete(key);
          rebuildTyping();
        }
        return;
      }
      if (payload.isTyping) {
        typingRef.current.set(key, {
          payload,
          expiresAt: now + 6000,
          lastUpdate: now,
        });
        const lastAlertAt = typingAlertRef.current.get(key) || 0;
        if (now - lastAlertAt >= 2500) {
          typingAlertRef.current.set(key, now);
          pushAlert?.({
            kind: 'chat-typing',
            payload,
            id: `chat-typing-${key}-${payload.id || Math.random().toString(36).slice(2)}`,
            receivedAt: now,
          });
        }
      } else {
        typingRef.current.delete(key);
      }
      rebuildTyping();
    }
    socket.on('chat:typing', handleTyping);
    return () => {
      socket.off('chat:typing', handleTyping);
    };
  }, [pushAlert, rebuildTyping, resolveTypingKey, session?.socketId, socket]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      typingRef.current.forEach((entry, key) => {
        if (entry.expiresAt <= now) {
          typingRef.current.delete(key);
          changed = true;
        }
      });
      if (changed) {
        rebuildTyping();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [rebuildTyping]);

  useEffect(() => {
    function handleInit(payload = []) {
      if (!Array.isArray(payload)) return;
      setMessages((prev) => {
        if (prev.length === 0) {
          return payload.slice(-100);
        }
        const seen = new Set(payload.map((entry) => entry?.id));
        const merged = [...payload, ...prev.filter((entry) => entry?.id && !seen.has(entry.id))];
        return merged.slice(-100);
      });
    }
    socket.on('chat:init', handleInit);
    return () => {
      socket.off('chat:init', handleInit);
    };
  }, [socket]);

  const setTypingActive = useCallback(
    (next) => {
      const isTyping = Boolean(next);
      const now = Date.now();
      const last = typingStateRef.current;
      const shouldSendStop = !isTyping && last.isTyping;
      const shouldSendStart =
        isTyping && (!last.isTyping || now - last.lastSent >= 3500);
      if (!shouldSendStart && !shouldSendStop) return;
      typingStateRef.current = { isTyping, lastSent: now };
      socket.emit('chat:typing', { isTyping });
    },
    [socket],
  );

  const sendMessage = useCallback(
    (text, tts = null) =>
      new Promise((resolve, reject) => {
        const payload = { text, tts };
        if (profileImage) payload.profileImage = profileImage;
        socket.emit('chat:send', payload, (resp = {}) => {
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp);
          }
        });
      }),
    [profileImage, socket],
  );

  const registerInputRef = useCallback((el, options = {}) => {
    const target = options?.target === 'hud' ? 'hud' : 'panel';
    if (target === 'hud') {
      hudInputRef.current = el;
    } else {
      panelInputRef.current = el;
    }
  }, []);

  const focusChat = useCallback(() => {
    setIsChatFocused(true);
    (hudInputRef.current || panelInputRef.current)?.focus();
  }, []);

  const blurChat = useCallback(() => {
    setIsChatFocused(false);
    hudInputRef.current?.blur();
    panelInputRef.current?.blur();
  }, []);

  const onInputFocus = useCallback(() => setIsChatFocused(true), []);
  const onInputBlur = useCallback(() => setIsChatFocused(false), []);

  // Each published value is memoized independently so React only wakes the
  // consumers attached to the slice that actually changed.
  const timelineValue = useMemo(
    () => ({
      messages,
      typing,
    }),
    [messages, typing],
  );

  const actionsValue = useMemo(
    () => ({
      sendMessage,
      focusChat,
      blurChat,
      registerInputRef,
      onInputFocus,
      onInputBlur,
      setTypingActive,
    }),
    [blurChat, focusChat, onInputBlur, onInputFocus, registerInputRef, sendMessage, setTypingActive],
  );

  const focusValue = useMemo(
    () => ({
      isChatFocused,
      selfSocketId: session?.socketId || null,
    }),
    [isChatFocused, session?.socketId],
  );

  const value = useMemo(
    () => ({
      ...timelineValue,
      ...actionsValue,
      ...focusValue,
    }),
    [actionsValue, focusValue, timelineValue],
  );

  return (
    // Nesting the focused providers keeps the public provider API unchanged for
    // callers while giving individual consumers smaller subscriptions.
    <ChatTimelineContext.Provider value={timelineValue}>
      <ChatActionsContext.Provider value={actionsValue}>
        <ChatFocusContext.Provider value={focusValue}>
          <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
        </ChatFocusContext.Provider>
      </ChatActionsContext.Provider>
    </ChatTimelineContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used inside ChatProvider');
  }
  return ctx;
}

export function useChatTimeline() {
  const ctx = useContext(ChatTimelineContext);
  if (!ctx) {
    throw new Error('useChatTimeline must be used inside ChatProvider');
  }
  return ctx;
}

export function useChatActions() {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) {
    throw new Error('useChatActions must be used inside ChatProvider');
  }
  return ctx;
}

export function useChatFocus() {
  const ctx = useContext(ChatFocusContext);
  if (!ctx) {
    throw new Error('useChatFocus must be used inside ChatProvider');
  }
  return ctx;
}
