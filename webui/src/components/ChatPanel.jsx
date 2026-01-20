import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import ChatMessageRow from './ChatMessageRow.jsx';

const FLITE_VOICES = ['kal', 'rms', 'slt', 'ksp', 'bdl'];
const ESPEAK_PITCHES = Array.from({ length: 10 }, (_, idx) => idx * 10);

export default function ChatPanel({ hideInput = false, hideSpectatorNotice = false, fillHeight = false }) {
  const { session } = useSession();
  const { messages, sendMessage, registerInputRef, onInputFocus, onInputBlur, blurChat } = useChat();
  const {
    value: ttsSettings,
    save: saveTtsSettings,
  } = useSettingsNamespace('tts', { engine: 'flite', voice: 'rms', pitch: 50 });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [engine, setEngine] = useState(() => ttsSettings?.engine || 'flite');
  const [voice, setVoice] = useState(() => ttsSettings?.voice || 'rms');
  const [pitch, setPitch] = useState(() => (Number.isFinite(ttsSettings?.pitch) ? ttsSettings.pitch : 50));
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
    const nextEngine = ttsSettings?.engine || 'flite';
    const nextVoice = ttsSettings?.voice || 'rms';
    const nextPitch = Number.isFinite(ttsSettings?.pitch) ? ttsSettings.pitch : 50;
    if (engine !== nextEngine) setEngine(nextEngine);
    if (voice !== nextVoice) setVoice(nextVoice);
    if (pitch !== nextPitch) setPitch(nextPitch);
  }, [engine, pitch, ttsSettings?.engine, ttsSettings?.pitch, ttsSettings?.voice, voice]);

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
      <div className={`surface overflow-y-auto space-y-0.5 px-0 ${listClass}`} ref={listRef}>
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No messages yet.</p>
        ) : (
          sorted.map((msg) => <ChatMessageRow key={msg.id} message={msg} />)
        )}
      </div>
      {!hideInput && (
        <form className="flex flex-wrap items-stretch gap-0.5" onSubmit={handleSend}>
          <input
            className="field-input flex-1 min-w-[10rem]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !draft.trim()) {
                event.preventDefault();
                blurChat();
              }
            }}
            ref={(el) => registerInputRef(el, { target: 'panel' })}
            placeholder={canChat ? 'Type a message…' : hideSpectatorNotice ? '' : 'Spectators cannot chat'}
            disabled={!canChat}
          />
          {ttsSupported && (
            <div className="flex flex-wrap items-center gap-0.5 basis-full sm:basis-auto">
              <label className="flex items-center gap-0.5 text-xs text-slate-300">
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
                onChange={(e) => {
                  const next = e.target.value;
                  setEngine(next);
                  saveTtsSettings((current) => ({ ...(current || {}), engine: next }));
                }}
                className="field-input text-xs"
              >
                <option value="flite">flite</option>
                <option value="espeak">espeak</option>
              </select>
              {engine === 'flite' ? (
                <select
                  value={voice}
                  onChange={(e) => {
                    const next = e.target.value;
                    setVoice(next);
                    saveTtsSettings((current) => ({ ...(current || {}), voice: next }));
                  }}
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
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setPitch(next);
                    saveTtsSettings((current) => ({ ...(current || {}), pitch: next }));
                  }}
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
          <button
            type="submit"
            disabled={!canChat || sending}
            className="button-dark h-full disabled:opacity-50 self-stretch"
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>
      )}
    </section>
  );
}
