import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

function roleColors(role) {
  switch (role) {
    case 'admin':
    case 'lockdown':
    case 'lockdown-admin':
      return 'text-amber-300';
    case 'spectator':
      return 'text-slate-400';
    default:
      return 'text-sky-300';
  }
}

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function displayName(message) {
  return message.nickname || message.socketId?.slice(0, 6) || 'unknown';
}

export default function ChatPanel() {
  const { session } = useSession();
  const { messages, sendMessage, registerInputRef, onInputFocus, onInputBlur, blurChat } = useChat();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const canChat = session?.role !== 'spectator';
  const listRef = useRef(null);

  const sorted = useMemo(() => messages.slice(-200), [messages]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [sorted]);

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat) return;
    const clean = draft.trim();
    if (!clean) return;
    setSending(true);
    try {
      await sendMessage(clean);
      setDraft('');
      blurChat();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel-section space-y-0.5 text-base">
      {/* <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Chat</span>
        <span className="text-xs text-slate-500">{sorted.length}</span>
      </div> */}
      <div className="surface h-48 overflow-y-auto space-y-0.25" ref={listRef}>
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No messages yet.</p>
        ) : (
          sorted.map((msg) => {
            const isAdmin =
              msg.role === 'admin' || msg.role === 'lockdown' || msg.role === 'lockdown-admin';
            return (
              <div
                key={msg.id}
                className={`surface-muted text-sm flex items-start gap-1 ${
                  isAdmin ? 'border border-amber-400/30' : msg.fromDiscord? 'border border-indigo-400/30' : ''
                }`}
              >
                <span className="text-[0.75rem] text-slate-400">{formatTime(msg.ts)}</span>
                <span className={`font-semibold text-[0.85rem] ${roleColors(msg.role)}`}>
                  {displayName(msg)}
                </span>
                {msg.fromDiscord && (
                  <span className="rounded bg-indigo-500/30 px-1 text-[0.7rem] text-indigo-100">
                    Discord
                  </span>
                )}
                {msg.roverId && (
                  <span className="rounded bg-slate-800 px-1 text-[0.7rem]">rover {msg.roverId}</span>
                )}
                <span className="text-slate-100 break-words leading-tight">{msg.text}</span>
              </div>
            );
          })
        )}
      </div>
      <form className="flex gap-0.5" onSubmit={handleSend}>
        <input
          className="field-input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          ref={(el) => registerInputRef(el)}
          placeholder={canChat ? 'Type a message…' : 'Spectators cannot chat'}
          disabled={!canChat}
        />
        <button type="submit" disabled={!canChat || sending} className="button-dark disabled:opacity-50">
          {sending ? '...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
