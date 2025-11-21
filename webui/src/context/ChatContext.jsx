/* eslint-disable react-refresh/only-export-components */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useSession } from './SessionContext.jsx';

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
  const { session } = useSession();
  const [messages, setMessages] = useState([]);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    function handleMessage(payload = {}) {
      setMessages((prev) => [...prev.slice(-99), payload]);
    }
    socket.on('chat:message', handleMessage);
    return () => {
      socket.off('chat:message', handleMessage);
    };
  }, [socket]);

  const sendMessage = useCallback(
    (text) =>
      new Promise((resolve, reject) => {
        socket.emit('chat:send', { text }, (resp = {}) => {
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp);
          }
        });
      }),
    [socket],
  );

  const registerInputRef = useCallback((el) => {
    inputRef.current = el;
  }, []);

  const focusChat = useCallback(() => {
    setIsChatFocused(true);
    inputRef.current?.focus();
  }, []);

  const blurChat = useCallback(() => {
    setIsChatFocused(false);
    inputRef.current?.blur();
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
