// Chat Panel
// Purpose: Defines the Chat Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import ChatMessageRow from '../ChatMessageRow/index.jsx';
import ChatTypingRow from '../ChatTypingRow/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import NicknameForm from '../NicknameForm/index.jsx';

const FLITE_VOICES = ['kal', 'rms', 'slt', 'ksp', 'bdl'];
const CHROME_TTS_VOICES = ['sfg', 'iob', 'iog', 'iol', 'iom', 'tpc', 'tpd', 'tpf'];
const ESPEAK_PITCHES = Array.from({ length: 10 }, (_, idx) => idx * 10);
const GOOGLE_TTS_VALUES = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_GOOGLE_TTS_VALUE = 1.0;

export default function ChatPanel({
  hideInput = false,
  hideSpectatorNotice = false,
  fillHeight = false,
  allowSpectatorInput = false,
  title = 'Chat and TTS',
  minimal = false,
}) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const currentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId || null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const {
    messages,
    typing,
    sendMessage,
    registerInputRef,
    onInputFocus,
    onInputBlur,
    blurChat,
    setTypingActive,
  } = useChat();
  const {
    value: ttsSettings,
    save: saveTtsSettings,
  } = useSettingsNamespace('tts', {
    engine: 'flite',
    voice: 'rms',
    pitch: 50,
    googlePitch: DEFAULT_GOOGLE_TTS_VALUE,
    googleSpeed: DEFAULT_GOOGLE_TTS_VALUE,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [engine, setEngine] = useState(() => ttsSettings?.engine || 'flite');
  const [voice, setVoice] = useState(() => ttsSettings?.voice || 'rms');
  const [pitch, setPitch] = useState(() => (Number.isFinite(ttsSettings?.pitch) ? ttsSettings.pitch : 50));
  const [googlePitch, setGooglePitch] = useState(() =>
    Number.isFinite(ttsSettings?.googlePitch) ? ttsSettings.googlePitch : DEFAULT_GOOGLE_TTS_VALUE,
  );
  const [googleSpeed, setGoogleSpeed] = useState(() =>
    Number.isFinite(ttsSettings?.googleSpeed) ? ttsSettings.googleSpeed : DEFAULT_GOOGLE_TTS_VALUE,
  );
  const canChat = role !== 'spectator' || allowSpectatorInput;
  const listRef = useRef(null);

  const rover = useMemo(
    () => roster.find((entry) => String(entry.id) === String(currentRoverId)) || null,
    [currentRoverId, roster],
  );
  const ttsSupported = Boolean(rover?.audio?.ttsEnabled);
  const effectiveHideInput = minimal || hideInput;
  const effectiveTitle = minimal ? '' : title;

  const sorted = useMemo(() => messages.slice(-200), [messages]);
  const typingRows = useMemo(() => typing || [], [typing]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [sorted, typingRows]);

  useEffect(() => {
    const nextEngine = ttsSettings?.engine || 'flite';
    const nextVoice = ttsSettings?.voice || 'rms';
    const nextPitch = Number.isFinite(ttsSettings?.pitch) ? ttsSettings.pitch : 50;
    const nextGooglePitch = Number.isFinite(ttsSettings?.googlePitch)
      ? ttsSettings.googlePitch
      : DEFAULT_GOOGLE_TTS_VALUE;
    const nextGoogleSpeed = Number.isFinite(ttsSettings?.googleSpeed)
      ? ttsSettings.googleSpeed
      : DEFAULT_GOOGLE_TTS_VALUE;
    if (engine !== nextEngine) setEngine(nextEngine);
    if (voice !== nextVoice) setVoice(nextVoice);
    if (pitch !== nextPitch) setPitch(nextPitch);
    if (googlePitch !== nextGooglePitch) setGooglePitch(nextGooglePitch);
    if (googleSpeed !== nextGoogleSpeed) setGoogleSpeed(nextGoogleSpeed);
  }, [
    engine,
    googlePitch,
    googleSpeed,
    pitch,
    ttsSettings?.engine,
    ttsSettings?.googlePitch,
    ttsSettings?.googleSpeed,
    ttsSettings?.pitch,
    ttsSettings?.voice,
    voice,
  ]);

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
    if (engine === 'chromegtts') {
      return { speak: true, engine, voice, pitch: googlePitch, speed: googleSpeed };
    }
    return { speak: true, engine, voice };
  }, [engine, googlePitch, googleSpeed, pitch, speak, ttsSupported, voice]);

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat || effectiveHideInput) return;
    // Allow users to type "\n" to represent a newline in messages
    const normalizedDraft = draft.replace(/\\n/g, '\n');
    const clean = normalizedDraft.trim();
    if (!clean) return;
    setSending(true);
    try {
      await sendMessage(clean, ttsPayload);
      setDraft('');
      blurChat();
      setTypingActive(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  const listClass = fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : 'h-48 overflow-y-auto';
  // The composer class owns the responsive row behavior in CSS. A container
  // query is used instead of JavaScript so the layout responds to the actual
  // panel width, which matters because this component appears in sidebars and
  // mobile layouts that do not map cleanly to viewport breakpoints.
  const composerClass = 'chat-composer';
  // Native selects include generous built-in padding and try to preserve the
  // width of their longest option. Removing horizontal padding and forcing
  // min-w-0 lets the row stay intact while keeping labels readable.
  const compactSelectClass = 'field-input min-w-0 max-w-full px-0 text-xs';

  return (
    <CardFrame
      title={effectiveTitle}
     
      hideHeader={minimal || !effectiveTitle}
      fillHeight={fillHeight}
      bodyClassName="space-y-0.5 text-base"
    >
      <div className={`overflow-y-auto space-y-0.5 px-0 ${listClass}`} ref={listRef}>
        {sorted.length === 0 && typingRows.length === 0 ? (
          <p className="text-sm text-slate-500">No messages yet.</p>
        ) : (
          sorted.map((msg) => <ChatMessageRow key={msg.id} message={msg} />)
        )}
        {typingRows.map((entry) => (
          <ChatTypingRow key={`typing-${entry.typingId || entry.id}`} message={entry} />
        ))}
      </div>
      {!effectiveHideInput && (
        <form className={composerClass} onSubmit={handleSend}>
          <div className="chat-composer-nickname">
            <NicknameForm compact />
          </div>
          <input
            className="field-input chat-composer-input"
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              setDraft(next);
              setTypingActive(Boolean(next.trim()));
            }}
            onFocus={(event) => {
              onInputFocus(event);
              setTypingActive(Boolean(draft.trim()));
            }}
            onBlur={(event) => {
              onInputBlur(event);
              setTypingActive(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !draft.trim()) {
                event.preventDefault();
                blurChat();
                setTypingActive(false);
              }
            }}
            ref={(el) => registerInputRef(el, { target: 'panel' })}
            placeholder={canChat ? 'Type a message…' : hideSpectatorNotice ? '' : 'Spectators cannot chat'}
            disabled={!canChat}
          />
          <button
            type="submit"
            disabled={!canChat || sending}
            className="button-dark chat-composer-send disabled:opacity-50"
          >
            {sending ? '...' : 'Send'}
          </button>
          {ttsSupported && (
            <div className="chat-composer-tts">
              <label className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-slate-300">
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
                  const nextVoice =
                    next === 'chromegtts' && !CHROME_TTS_VOICES.includes(voice)
                      ? 'tpf'
                      : next === 'flite' && !FLITE_VOICES.includes(voice)
                      ? 'rms'
                      : voice;
                  setEngine(next);
                  if (nextVoice !== voice) setVoice(nextVoice);
                  saveTtsSettings((current) => ({ ...(current || {}), engine: next, voice: nextVoice }));
                }}
                className={`${compactSelectClass} w-[5.5rem] shrink`}
              >
                <option value="flite">flite</option>
                <option value="espeak">espeak</option>
                <option value="chromegtts">Google TTS</option>
              </select>
              {engine === 'flite' || engine === 'chromegtts' ? (
                <>
                  <select
                    value={voice}
                    onChange={(e) => {
                      const next = e.target.value;
                      setVoice(next);
                      saveTtsSettings((current) => ({ ...(current || {}), voice: next }));
                    }}
                    className={`${compactSelectClass} w-[3.25rem] shrink`}
                  >
                    {(engine === 'chromegtts' ? CHROME_TTS_VOICES : FLITE_VOICES).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {engine === 'chromegtts' && (
                    <>
                      <select
                        value={googlePitch}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setGooglePitch(next);
                          saveTtsSettings((current) => ({ ...(current || {}), googlePitch: next }));
                        }}
                        className={`${compactSelectClass} w-[5rem] shrink`}
                      >
                        {GOOGLE_TTS_VALUES.map((value) => (
                          <option key={`pitch-${value}`} value={value}>
                            pitch {value.toFixed(2)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={googleSpeed}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setGoogleSpeed(next);
                          saveTtsSettings((current) => ({ ...(current || {}), googleSpeed: next }));
                        }}
                        className={`${compactSelectClass} w-[5rem] shrink`}
                      >
                        {GOOGLE_TTS_VALUES.map((value) => (
                          <option key={`speed-${value}`} value={value}>
                            speed {value.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </>
              ) : (
                <select
                  value={pitch}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setPitch(next);
                    saveTtsSettings((current) => ({ ...(current || {}), pitch: next }));
                  }}
                  className={`${compactSelectClass} w-[4.5rem] shrink`}
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
        </form>
      )}
    </CardFrame>
  );
}
