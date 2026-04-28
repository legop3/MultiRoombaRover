// Hud Chat Input
// Purpose: Defines the Hud Chat Input module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';

export default function HudChatInput({ compact = false }) {
  const session = useSessionSelector((state) => state.session);
  const { sendMessage, onInputFocus, onInputBlur, blurChat, registerInputRef, setTypingActive } = useChat();
  const { value: ttsSettings } = useSettingsNamespace('tts', { engine: 'flite', voice: 'rms', pitch: 50 });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const canChat = session?.role !== 'spectator';
  const hideHudChat = session?.role === 'spectator';
  const currentRoverId = session?.assignment?.roverId || null;
  const rover = useMemo(
    () => session?.roster?.find((entry) => String(entry.id) === String(currentRoverId)) || null,
    [currentRoverId, session?.roster],
  );
  const ttsSupported = Boolean(rover?.audio?.ttsEnabled);
  const ttsPayload = useMemo(() => {
    if (!ttsSupported) return null;
    const engine = ttsSettings?.engine === 'espeak' ? 'espeak' : 'flite';
    if (engine === 'espeak') {
      let pitch = Number.isFinite(ttsSettings?.pitch) ? Math.round(ttsSettings.pitch) : undefined;
      if (typeof pitch === 'number') {
        pitch = Math.max(0, Math.min(99, pitch));
      }
      return { speak: true, engine, pitch };
    }
    const voice = typeof ttsSettings?.voice === 'string' ? ttsSettings.voice : undefined;
    return { speak: true, engine, voice };
  }, [ttsSettings?.engine, ttsSettings?.pitch, ttsSettings?.voice, ttsSupported]);
  const containerClass = compact
    ? 'pointer-events-auto absolute bottom-0.5 right-0.5 flex w-[9rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.4 py-0.2'
    : 'pointer-events-auto absolute bottom-1 right-1 flex w-[12rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.5 py-0.25';
  const inputClass = compact
    ? 'min-w-0 flex-1 bg-transparent text-[0.55rem] text-slate-100 placeholder:text-slate-400 focus:outline-none'
    : 'min-w-0 flex-1 bg-transparent text-[0.7rem] text-slate-100 placeholder:text-slate-400 focus:outline-none';
  const buttonClass = compact
    ? 'rounded bg-cyan-500/80 px-0.35 py-0.2 text-[0.55rem] font-semibold text-black disabled:opacity-50'
    : 'rounded bg-cyan-500/80 px-0.5 py-0.25 text-[0.7rem] font-semibold text-black disabled:opacity-50';

  async function handleSend(event) {
    event.preventDefault();
    if (!canChat) return;
    const clean = draft.trim();
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

  if (hideHudChat) return null;

  return (
    <form onSubmit={handleSend} className={containerClass}>
      <input
        className={inputClass}
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
        ref={(el) => registerInputRef(el, { target: 'hud' })}
        placeholder={canChat ? 'Chat (TTS)' : 'Spectator'}
        disabled={!canChat}
      />
      <button type="submit" disabled={!canChat || sending} className={buttonClass}>
        Speak
      </button>
    </form>
  );
}
