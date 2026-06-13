// Scanner Speech Hook
// Purpose: Speaks server-provided scan labels on the scanner computer.
// Scope: Plays server-generated scanner audio when available, with browser TTS as the local fallback output device.
import { useEffect, useRef } from 'react';

const SPEECH_START_TIMEOUT_MS = 1500;
const SPEECH_RETRY_DELAY_MS = 700;
const SERVER_AUDIO_GRACE_MS = 350;
export const SCANNER_VOICE_STORAGE_KEY = 'scanner.preferredVoiceName';
const PREFERRED_VOICE_PATTERN = /female|samantha|victoria|allison|zira|karen|moira|serena|ava|susan|hazel|google (us|uk) english/i;
const NOVELTY_VOICE_PATTERN = /whisper|bubbles|bells|boing|bad news|bahh|cellos|deranged|good news|hysterical|pipe organ|trinoids|zarvox/i;

function isNoveltyVoice(voice) {
  return NOVELTY_VOICE_PATTERN.test(String(voice?.name || ''));
}

function pickScannerVoice(synth) {
  const voices = typeof synth?.getVoices === 'function' ? synth.getVoices() : [];
  if (!voices.length) return null;

  const savedVoiceName =
    typeof window !== 'undefined'
      ? String(window.localStorage.getItem(SCANNER_VOICE_STORAGE_KEY) || '').trim()
      : '';
  const savedVoice = savedVoiceName
    ? voices.find((voice) => String(voice?.name || '') === savedVoiceName)
    : null;
  if (savedVoice) return savedVoice;

  const usableVoices = voices.filter((voice) => !isNoveltyVoice(voice));
  const defaultVoice = usableVoices.find((voice) => voice?.default) || null;
  const englishVoices = usableVoices.filter((voice) => String(voice?.lang || '').toLowerCase().startsWith('en'));
  // Browser voice lists vary by operating system and installed speech packs, so
  // this is intentionally a preference rather than a requirement. A recognized
  // female-sounding English voice is best for the scanner speaker, but any
  // normal/default voice is better than accidentally choosing a novelty voice
  // like Whisper just because it appears early in the browser's voice list.
  return (
    englishVoices.find((voice) => PREFERRED_VOICE_PATTERN.test(String(voice?.name || ''))) ||
    usableVoices.find((voice) => PREFERRED_VOICE_PATTERN.test(String(voice?.name || ''))) ||
    defaultVoice ||
    englishVoices[0] ||
    usableVoices[0] ||
    null
  );
}

function normalizeAudioBuffer(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return buffer;
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  if (Array.isArray(buffer)) {
    return new Uint8Array(buffer).buffer;
  }
  return null;
}

function playServerAudio(audio) {
  const audioBuffer = normalizeAudioBuffer(audio?.buffer);
  if (!audioBuffer) return null;
  const mime = String(audio?.mime || 'audio/wav').trim() || 'audio/wav';
  const blob = new Blob([audioBuffer], { type: mime });
  const objectUrl = URL.createObjectURL(blob);
  const player = new Audio(objectUrl);
  player.volume = 1;

  return {
    play: () =>
      player.play().finally(() => {
        // The generated clip is only needed once per scan. Releasing the object
        // URL after play starts/ends prevents repeated scans from leaking blobs
        // on a long-running scanner page.
        player.onended = () => URL.revokeObjectURL(objectUrl);
      }),
    stop: () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export default function useScannerSpeech(scan, serverAudioEvent = null) {
  const retryTimerRef = useRef(null);
  const startTimerRef = useRef(null);
  const spokenScanKeyRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const serverAudioPlayerRef = useRef(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(startTimerRef.current);
      window.clearTimeout(fallbackTimerRef.current);
      serverAudioPlayerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const speechText = String(scan?.speechText || '').trim();
    const scanKey = scan?.scannedAt ? `${scan.scannedAt}:${speechText}` : '';
    if (!speechText || !scanKey || spokenScanKeyRef.current === scanKey) return undefined;

    let cancelled = false;

    function clearSpeechTimers() {
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(startTimerRef.current);
      window.clearTimeout(fallbackTimerRef.current);
      retryTimerRef.current = null;
      startTimerRef.current = null;
      fallbackTimerRef.current = null;
    }

    function retryLater() {
      if (cancelled) return;
      clearSpeechTimers();
      retryTimerRef.current = window.setTimeout(() => speakBrowserOnce(), SPEECH_RETRY_DELAY_MS);
    }

    function speakWithBrowserFallback() {
      const synth = window.speechSynthesis;
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        retryLater();
        return;
      }

      clearSpeechTimers();
      // Cancelling before retrying prevents stale utterances from piling up if a
      // browser reports an error or never fires the expected start callback.
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(speechText);
      const preferredVoice = pickScannerVoice(synth);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      };
      utterance.onend = () => {
        clearSpeechTimers();
      };
      utterance.onerror = () => {
        retryLater();
      };
      synth.speak(utterance);

      // Some browser/audio states fail without surfacing onerror. A small start
      // watchdog keeps the required scanner audio from silently dying, while the
      // UI remains clean and rover-readable.
      startTimerRef.current = window.setTimeout(() => {
        synth.cancel();
        retryLater();
      }, SPEECH_START_TIMEOUT_MS);
    }

    function markSpoken() {
      spokenScanKeyRef.current = scanKey;
    }

    function speakBrowserOnce() {
      if (cancelled) return;
      markSpoken();
      clearSpeechTimers();
      serverAudioPlayerRef.current?.stop();
      speakWithBrowserFallback();
    }

    // Server-generated audio is preferred, but it arrives on a separate scanner
    // socket event after the immediate scan state. Waiting briefly lets cached
    // Kokoro clips play without delaying the visual scan result; if the clip is
    // still being generated, the page falls back to Web Speech for this scan.
    fallbackTimerRef.current = window.setTimeout(speakBrowserOnce, SERVER_AUDIO_GRACE_MS);

    return () => {
      cancelled = true;
      clearSpeechTimers();
      serverAudioPlayerRef.current?.stop();
    };
  }, [scan]);

  useEffect(() => {
    const speechText = String(serverAudioEvent?.scan?.speechText || '').trim();
    const scanKey = serverAudioEvent?.scan?.scannedAt ? `${serverAudioEvent.scan.scannedAt}:${speechText}` : '';
    const currentSpeechText = String(scan?.speechText || '').trim();
    const currentScanKey = scan?.scannedAt ? `${scan.scannedAt}:${currentSpeechText}` : '';
    if (!scanKey || scanKey !== currentScanKey || spokenScanKeyRef.current === scanKey) return;

    const player = playServerAudio(serverAudioEvent.audio);
    if (!player) return;
    window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    spokenScanKeyRef.current = scanKey;
    serverAudioPlayerRef.current?.stop();
    serverAudioPlayerRef.current = player;
    player.play().catch(() => {
      // If the generated clip cannot play for any browser reason, fall back to
      // the selected Web Speech voice rather than leaving the scan silent.
      spokenScanKeyRef.current = scanKey;
      const synth = window.speechSynthesis;
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(currentSpeechText);
      const preferredVoice = pickScannerVoice(synth);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      synth.speak(utterance);
    });
  }, [scan, serverAudioEvent]);
}
