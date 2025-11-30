import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext.jsx';
import { useSession } from '../context/SessionContext.jsx';

function roleColors(role, fromDiscord) {
  if (fromDiscord) return 'text-indigo-200';
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

const FLITE_VOICES = ['kal', 'rms', 'slt', 'ksp', 'bdl'];
const ESPEAK_PITCHES = Array.from({ length: 10 }, (_, idx) => idx * 10);

export default function ChatPanel({ hideInput = false, hideSpectatorNotice = false, fillHeight = false }) {
  const { session } = useSession();
  const { messages, sendMessage, registerInputRef, onInputFocus, onInputBlur, blurChat } = useChat();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [engine, setEngine] = useState('flite');
  const [voice, setVoice] = useState('rms');
  const [pitch, setPitch] = useState(50);
  const canChat = session?.role !== 'spectator';
  const listRef = useRef(null);
  const currentRoverId = session?.assignment?.roverId || null;

  const rover = useMemo(
    () => session?.roster?.find((entry) => String(entry.id) === String(currentRoverId)) || null,
    [currentRoverId, session?.roster],
  );
  const ttsSupported = Boolean(rover?.audio?.ttsEnabled);

  const sorted = useMemo(() => messages.slice(-200), [messages]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [sorted]);

  useEffect(() => {
    if (ttsSupported) {
      setSpeak(true);
    } else {
      setSpeak(false);
    }
  }, [ttsSupported]);

  const ttsPayload = useMemo(() => {
    if (!ttsSupported || !speak) return null;
    if (engine === 'espeak') {
      return { speak: true, engine, pitch };
    }
    return { speak: true, engine, voice };
  }, [engine, pitch, speak, ttsSupported, voice]);

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat || hideInput) return;
    // Allow users to type "\n" to represent a newline in messages
    const normalizedDraft = draft.replace(/\\n/g, '\n');
    const clean = normalizedDraft.trim();
    if (!clean) return;
    setSending(true);
    try {
      await sendMessage(clean, ttsPayload);
      setDraft('');
      blurChat();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  const listClass = fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : 'h-48 overflow-y-auto';

  return (
    <section className={`panel-section space-y-0.5 text-base ${fillHeight ? 'flex h-full flex-col overflow-hidden' : ''}`}>
      <div className={`surface overflow-y-auto space-y-0.25 ${listClass}`} ref={listRef}>
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
                  isAdmin
                    ? 'border border-amber-400/30'
                    : msg.fromDiscord
                      ? 'border border-indigo-400/30 bg-indigo-900/20'
                      : ''
                }`}
              >
                <span className="text-[0.75rem] text-slate-400">{formatTime(msg.ts)}</span>
                <span className={`font-semibold text-[0.85rem] ${roleColors(msg.role, msg.fromDiscord)}`}>
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
                <span className="text-slate-100 break-words leading-tight whitespace-pre-wrap">{msg.text}</span>
              </div>
            );
          })
        )}
      </div>
      {!hideInput && (
        <form className="flex gap-0.5" onSubmit={handleSend}>
          <input
            className="field-input flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
            ref={(el) => registerInputRef(el)}
            placeholder={canChat ? 'Type a message…' : hideSpectatorNotice ? '' : 'Spectators cannot chat'}
            disabled={!canChat}
          />
          {ttsSupported && (
            <div className="flex items-center gap-0.5">
              <label className="flex items-center gap-0.25 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={speak}
                  onChange={(e) => setSpeak(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span>Speak</span>
              </label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="field-input text-xs"
              >
                <option value="flite">flite</option>
                <option value="espeak">espeak</option>
              </select>
              {engine === 'flite' ? (
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="field-input text-xs"
                >
                  {FLITE_VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={pitch}
                  onChange={(e) => setPitch(Number(e.target.value))}
                  className="field-input text-xs"
                >
                  {ESPEAK_PITCHES.map((p) => (
                    <option key={p} value={p}>
                      pitch {p}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <button type="submit" disabled={!canChat || sending} className="button-dark disabled:opacity-50">
            {sending ? '...' : 'Send'}
          </button>
        </form>
      )}
    </section>
  );
}
