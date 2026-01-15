/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useSession } from './SessionContext.jsx';
import messageSound from '../assets/message.mp3';

const ChatContext = createContext({
  messages: [],
  sendMessage: async () => {},
  focusChat: () => {},
  blurChat: () => {},
  registerInputRef: () => {},
  onInputFocus: () => {},
  onInputBlur: () => {},
  isChatFocused: false,
});

export function ChatProvider({ children }) {
  const socket = useSocket();
  const { session, pushAlert } = useSession();
  const [messages, setMessages] = useState([]);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const panelInputRef = useRef(null);
  const hudInputRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio(messageSound);
    audioRef.current.load();
  }, []);

  const playSound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

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
  }, [playSound, session?.socketId, socket]);

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

  const sendMessage = useCallback(
    (text, tts = null) =>
      new Promise((resolve, reject) => {
        socket.emit('chat:send', { text, tts }, (resp = {}) => {
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp);
          }
        });
      }),
    [socket],
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

  const value = useMemo(
    () => ({
      messages,
      sendMessage,
      focusChat,
      blurChat,
      registerInputRef,
      onInputFocus,
      onInputBlur,
      isChatFocused,
      selfSocketId: session?.socketId || null,
    }),
    [blurChat, focusChat, isChatFocused, messages, onInputBlur, onInputFocus, registerInputRef, sendMessage, session?.socketId],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used inside ChatProvider');
  }
  return ctx;
}
