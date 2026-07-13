// Chat Panel
// Purpose: Renders the chat transcript, nickname editor, message composer, and optional TTS controls.
// Scope: Keeps timeline updates isolated from controlled form inputs so incoming chat activity does not
// force the composer DOM to re-commit while a user is simply watching or driving.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useChatActions, useChatTimeline } from '../../context/ChatContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import ChatMessageRow from '../ChatMessageRow/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import NicknameForm from '../NicknameForm/index.jsx';

const FLITE_VOICES = ['kal', 'rms', 'slt', 'ksp', 'bdl'];
const CHROME_TTS_VOICES = ['sfg', 'iob', 'iog', 'iol', 'iom', 'tpc', 'tpd', 'tpf'];
const ESPEAK_PITCHES = Array.from({ length: 10 }, (_, idx) => idx * 10);
const GOOGLE_TTS_VALUES = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_GOOGLE_TTS_VALUE = 1.0;
const DEFAULT_GOOGLE_TTS_VOICE = 'tpf';

const TTS_SETTINGS_DEFAULTS = {
  engine: 'chromegtts',
  voice: DEFAULT_GOOGLE_TTS_VOICE,
  pitch: 50,
  googlePitch: DEFAULT_GOOGLE_TTS_VALUE,
  googleSpeed: DEFAULT_GOOGLE_TTS_VALUE,
};

function formatGoogleSpeedLabel(engineSpeed) {
  // Chrome's local Google TTS model treats this parameter like a duration
  // multiplier, so larger raw values sound slower. Keep the raw saved value and
  // rover payload unchanged, but show the reciprocal so the dropdown reads like
  // a normal user-facing speed control where larger means faster.
  return (1 / engineSpeed).toFixed(2);
}

function resolveTtsSettings(settings) {
  return {
    engine: settings?.engine || TTS_SETTINGS_DEFAULTS.engine,
    voice: settings?.voice || TTS_SETTINGS_DEFAULTS.voice,
    pitch: Number.isFinite(settings?.pitch) ? settings.pitch : TTS_SETTINGS_DEFAULTS.pitch,
    googlePitch: Number.isFinite(settings?.googlePitch)
      ? settings.googlePitch
      : TTS_SETTINGS_DEFAULTS.googlePitch,
    googleSpeed: Number.isFinite(settings?.googleSpeed)
      ? settings.googleSpeed
      : TTS_SETTINGS_DEFAULTS.googleSpeed,
  };
}

function useChatComposerSessionState(allowSpectatorInput) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const currentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId || null);
  const users = useSessionSelector((state) => state.session?.users ?? []);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);

  const chatTargetId = useMemo(() => {
    /*
      PTZ is intentionally not a roster entry, but session users expose the
      current chat target for each socket. Prefer the self user entry so the TTS
      control follows PTZ queue/operation state instead of only physical rover
      assignment state.
    */
    const self = users.find((entry) => entry?.socketId === socketId);
    if (!self?.roverId && ptz?.id && (ptz?.isOperator || ptz?.queuedPosition)) return ptz.id;
    return self?.roverId || currentRoverId || null;
  }, [currentRoverId, ptz?.id, ptz?.isOperator, ptz?.queuedPosition, socketId, users]);

  const rover = useMemo(
    () => roster.find((entry) => String(entry.id) === String(chatTargetId)) || null,
    [chatTargetId, roster],
  );
  const ptzTtsSupported = Boolean(
    ptz?.id &&
      String(chatTargetId) === String(ptz.id) &&
      ptz?.audio?.enabled &&
      (ptz?.isOperator || ptz?.queuedPosition),
  );

  return {
    canChat: role !== 'spectator' || allowSpectatorInput,
    ttsSupported: Boolean(rover?.audio?.ttsEnabled || ptzTtsSupported),
  };
}

function ChatMessageList({ fillHeight = false }) {
  const { messages, typing } = useChatTimeline();
  const listRef = useRef(null);
  const sorted = useMemo(() => messages.slice(-200), [messages]);
  const typingRows = useMemo(() => typing || [], [typing]);
  const listClass = fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : 'h-48 overflow-y-auto';

  useEffect(() => {
    if (!listRef.current) return;

    // Keep the transcript pinned to the newest activity. This effect intentionally
    // lives with the timeline subscriber, because scrolling the message list is the
    // only DOM work that should happen when messages or typing indicators change.
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [sorted, typingRows]);

  return (
    <div className={`overflow-y-auto space-y-0.5 px-0 ${listClass}`} ref={listRef}>
      {sorted.length === 0 && typingRows.length === 0 ? (
        <p className="text-sm text-slate-500">No messages yet.</p>
      ) : (
        sorted.map((msg) => <ChatMessageRow key={msg.id} message={msg} />)
      )}
      {typingRows.map((entry) => (
        <ChatMessageRow key={`typing-${entry.typingId || entry.id}`} message={entry} variant="typing" />
      ))}
    </div>
  );
}

const MemoizedNicknameForm = memo(NicknameForm);

function TtsControls({
  ttsSupported,
  speak,
  onSpeakChange,
  engine,
  voice,
  pitch,
  googlePitch,
  googleSpeed,
  saveTtsSettings,
}) {
  if (!ttsSupported) return null;

  // Native selects include generous built-in padding and try to preserve the
  // width of their longest option. Removing horizontal padding and forcing
  // min-w-0 lets the row stay intact while keeping labels readable.
  const compactSelectClass = 'field-input min-w-0 max-w-full px-0 text-xs';

  return (
    <div className="chat-composer-tts">
      <label className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-slate-300">
        <input
          type="checkbox"
          checked={speak}
          onChange={(event) => onSpeakChange(event.target.checked)}
          className="accent-cyan-500"
        />
        <span>Speak</span>
      </label>
      <select
        value={engine}
        onChange={(event) => {
          const next = event.target.value;
          const nextVoice =
            next === 'chromegtts' && !CHROME_TTS_VOICES.includes(voice)
              ? DEFAULT_GOOGLE_TTS_VOICE
              : next === 'flite' && !FLITE_VOICES.includes(voice)
                ? 'rms'
                : voice;
          saveTtsSettings((current) => ({ ...(current || {}), engine: next, voice: nextVoice }));
        }}
        className={`${compactSelectClass} w-[5.5rem] shrink`}
      >
        <option value="flite">flite</option>
        <option value="espeak">espeak</option>
        <option value="chromegtts">Google speech</option>
      </select>
      {engine === 'flite' || engine === 'chromegtts' ? (
        <>
          <select
            value={voice}
            onChange={(event) => {
              const next = event.target.value;
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
                onChange={(event) => {
                  const next = Number(event.target.value);
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
                onChange={(event) => {
                  const next = Number(event.target.value);
                  saveTtsSettings((current) => ({ ...(current || {}), googleSpeed: next }));
                }}
                className={`${compactSelectClass} w-[5rem] shrink`}
              >
                {GOOGLE_TTS_VALUES.map((value) => (
                  <option key={`speed-${value}`} value={value}>
                    speed {formatGoogleSpeedLabel(value)}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      ) : (
        <select
          value={pitch}
          onChange={(event) => {
            const next = Number(event.target.value);
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
  );
}

function ChatComposer({
  allowSpectatorInput = false,
  hideSpectatorNotice = false,
  inputTarget = 'panel',
}) {
  const {
    sendMessage,
    registerInputRef,
    onInputFocus,
    onInputBlur,
    blurChat,
    setTypingActive,
  } = useChatActions();
  const { canChat, ttsSupported } = useChatComposerSessionState(allowSpectatorInput);
  const {
    value: ttsSettings,
    save: saveTtsSettings,
  } = useSettingsNamespace('tts', TTS_SETTINGS_DEFAULTS);
  const {
    engine,
    voice,
    pitch,
    googlePitch,
    googleSpeed,
  } = resolveTtsSettings(ttsSettings);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [speak, setSpeak] = useState(true);
  const effectiveSpeak = ttsSupported && speak;
  const ttsPayload = useMemo(() => {
    if (!effectiveSpeak) return null;

    // The payload is derived during render from the current settings instead of
    // mirrored into local state. That removes an effect-driven state sync path and
    // keeps the composer render count tied to real user/settings changes.
    if (engine === 'espeak') {
      return { speak: true, engine, pitch };
    }
    if (engine === 'chromegtts') {
      return { speak: true, engine, voice, pitch: googlePitch, speed: googleSpeed };
    }
    return { speak: true, engine, voice };
  }, [effectiveSpeak, engine, googlePitch, googleSpeed, pitch, voice]);

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat) return;

    // Allow users to type "\n" to represent a newline in messages. This keeps the
    // single-line composer compatible with users who still want line breaks in the
    // delivered chat payload.
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

  // The composer class owns the responsive row behavior in CSS. A container
  // query is used instead of JavaScript so the layout responds to the actual
  // panel width, which matters because this component appears in sidebars and
  // mobile layouts that do not map cleanly to viewport breakpoints.
  return (
    <form className="chat-composer" onSubmit={handleSend}>
      <div className="chat-composer-nickname">
        <MemoizedNicknameForm compact />
      </div>
      <input
        className="field-input chat-composer-input"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
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
        ref={(el) => registerInputRef(el, { target: inputTarget })}
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
      <TtsControls
        ttsSupported={ttsSupported}
        speak={effectiveSpeak}
        onSpeakChange={setSpeak}
        engine={engine}
        voice={voice}
        pitch={pitch}
        googlePitch={googlePitch}
        googleSpeed={googleSpeed}
        saveTtsSettings={saveTtsSettings}
      />
    </form>
  );
}

const MemoizedChatMessageList = memo(ChatMessageList);
const MemoizedChatComposer = memo(ChatComposer);

export default function ChatPanel({
  hideInput = false,
  hideSpectatorNotice = false,
  fillHeight = false,
  allowSpectatorInput = false,
  title = 'Chat and speech',
  minimal = false,
  inputTarget = 'panel',
}) {
  const effectiveHideInput = minimal || hideInput;
  const effectiveTitle = minimal ? '' : title;

  return (
    <CardFrame
      title={effectiveTitle}
      hideHeader={minimal || !effectiveTitle}
      fillHeight={fillHeight}
      bodyClassName="space-y-0.5 text-base"
    >
      <MemoizedChatMessageList fillHeight={fillHeight} />
      {!effectiveHideInput && (
        <MemoizedChatComposer
          allowSpectatorInput={allowSpectatorInput}
          hideSpectatorNotice={hideSpectatorNotice}
          inputTarget={inputTarget}
        />
      )}
    </CardFrame>
  );
}
