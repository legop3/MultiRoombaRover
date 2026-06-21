// Hud Chat Input
// Purpose: Defines the Hud Chat Input module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { memo, useMemo, useState } from 'react';
import { useChatActions } from '../../../context/ChatContext.jsx';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../../settings/index.js';

function detectSafari() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const vendor = navigator.vendor || '';

  /*
    Safari is the browser that needs the 16px focused-input workaround. Chrome
    and Firefox on iOS also use WebKit internally, but they identify themselves
    in the user agent, so leave their HUD chat sizing alone unless they report
    as Safari proper.
  */
  return /safari/i.test(userAgent) &&
    /apple/i.test(vendor) &&
    !/crios|fxios|edgios|opr|chrome|android/i.test(userAgent);
}

function HudChatInput({ compact = false }) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const currentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId || null);
  const roverRoster = useSessionSelector((state) => state.session?.roster || []);
  const { sendMessage, onInputFocus, onInputBlur, blurChat, registerInputRef, setTypingActive } = useChatActions();
  const { value: ttsSettings } = useSettingsNamespace('tts', {
    // HUD chat shares the normal browser TTS defaults, but it has no visible
    // controls of its own. Keeping the fallback here on Google speech prevents
    // the compact HUD path from silently reverting to flite for fresh users.
    engine: 'chromegtts',
    voice: 'tpf',
    pitch: 50,
    googlePitch: 1,
    googleSpeed: 1,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const canChat = role !== 'spectator';
  const hideHudChat = role === 'spectator';
  const rover = useMemo(
    () => roverRoster.find((entry) => String(entry.id) === String(currentRoverId)) || null,
    [currentRoverId, roverRoster],
  );
  const ttsSupported = Boolean(rover?.audio?.ttsEnabled);
  const ttsPayload = useMemo(() => {
    if (!ttsSupported) return null;
    const engine =
      ttsSettings?.engine === 'espeak' ? 'espeak' : ttsSettings?.engine === 'flite' ? 'flite' : 'chromegtts';
    if (engine === 'espeak') {
      let pitch = Number.isFinite(ttsSettings?.pitch) ? Math.round(ttsSettings.pitch) : undefined;
      if (typeof pitch === 'number') {
        pitch = Math.max(0, Math.min(99, pitch));
      }
      return { speak: true, engine, pitch };
    }
    const voice = typeof ttsSettings?.voice === 'string' ? ttsSettings.voice : undefined;
    if (engine === 'chromegtts') {
      const pitch = Number.isFinite(ttsSettings?.googlePitch) ? ttsSettings.googlePitch : 1;
      const speed = Number.isFinite(ttsSettings?.googleSpeed) ? ttsSettings.googleSpeed : 1;
      return { speak: true, engine, voice, pitch, speed };
    }
    return { speak: true, engine, voice };
  }, [
    ttsSettings?.engine,
    ttsSettings?.googlePitch,
    ttsSettings?.googleSpeed,
    ttsSettings?.pitch,
    ttsSettings?.voice,
    ttsSupported,
  ]);
  const containerClass = compact
    ? 'pointer-events-auto absolute bottom-0.5 right-0.5 flex w-[9rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.4 py-0.2'
    : 'pointer-events-auto absolute bottom-1 right-1 flex w-[12rem] max-w-[70vw] items-center gap-0.5 rounded bg-black/70 px-0.5 py-0.25';
  const isSafari = useMemo(() => detectSafari(), []);
  /*
    Safari zooms focused inputs below 16px. Keep that workaround Safari-only so
    other mobile browsers keep the deliberately tiny HUD typography.
  */
  const inputTextClass = isSafari ? 'mobile-text-entry' : compact ? 'text-[0.55rem]' : 'text-[0.7rem]';
  const inputClass = `min-w-0 flex-1 bg-transparent ${inputTextClass} text-slate-100 placeholder:text-slate-400 focus:outline-none`;
  // The submit button is still a touch target even though the adjacent input must
  // remain editable, so it gets press suppression without inheriting input text
  // selection behavior.
  const buttonClass = compact
    ? 'mobile-touch-control rounded bg-cyan-500/80 px-0.35 py-0.2 text-[0.55rem] font-semibold text-black disabled:opacity-50'
    : 'mobile-touch-control rounded bg-cyan-500/80 px-0.5 py-0.25 text-[0.7rem] font-semibold text-black disabled:opacity-50';

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
        placeholder={canChat ? 'Chat (tts)' : 'Spectator'}
        disabled={!canChat}
      />
      <button type="submit" disabled={!canChat || sending} className={buttonClass}>
        Speak
      </button>
    </form>
  );
}

export default memo(HudChatInput);
