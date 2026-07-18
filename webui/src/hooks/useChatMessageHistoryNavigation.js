// Chat Message History Navigation
// Purpose: Gives each chat input Bash-style traversal over the shared persisted send history.
// Scope: Owns only draft/navigation state; it does not register global keys or interact with rover controls.
import { useCallback, useRef } from 'react';
import { useChatHistory } from '../context/ChatContext.jsx';

export default function useChatMessageHistoryNavigation() {
  const { messageHistory } = useChatHistory();
  const historyIndexRef = useRef(null);
  const preservedDraftRef = useRef('');

  const resetHistoryNavigation = useCallback(() => {
    // Manual edits and successful sends begin a new navigation session. The
    // current input value remains owned by the composer and is not changed here.
    historyIndexRef.current = null;
    preservedDraftRef.current = '';
  }, []);

  const navigateHistory = useCallback(
    (direction, currentDraft) => {
      if (!messageHistory.length) return null;

      if (direction === 'previous') {
        if (historyIndexRef.current === null) {
          // Save the in-progress draft exactly once so ArrowDown can restore it
          // after the user reaches the newest edge of history, like a shell.
          preservedDraftRef.current = currentDraft;
          historyIndexRef.current = messageHistory.length - 1;
        } else {
          historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);
        }
        return messageHistory[historyIndexRef.current];
      }

      if (direction === 'next' && historyIndexRef.current !== null) {
        if (historyIndexRef.current < messageHistory.length - 1) {
          historyIndexRef.current += 1;
          return messageHistory[historyIndexRef.current];
        }

        const preservedDraft = preservedDraftRef.current;
        resetHistoryNavigation();
        return preservedDraft;
      }

      return null;
    },
    [messageHistory, resetHistoryNavigation],
  );

  return { navigateHistory, resetHistoryNavigation };
}
