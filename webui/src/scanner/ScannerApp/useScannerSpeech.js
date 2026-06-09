// Scanner Speech Hook
// Purpose: Speaks server-provided scan labels on the scanner computer.
// Scope: Keeps browser TTS as a local output device while leaving scan meaning and phrase selection on the server.
import { useEffect, useRef } from 'react';

const SPEECH_START_TIMEOUT_MS = 1500;
const SPEECH_RETRY_DELAY_MS = 700;
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

export default function useScannerSpeech(scan) {
  const retryTimerRef = useRef(null);
  const startTimerRef = useRef(null);
  const spokenScanKeyRef = useRef(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(startTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const speechText = String(scan?.speechText || '').trim();
    const scanKey = scan?.scannedAt ? `${scan.scannedAt}:${speechText}` : '';
    if (!speechText || !scanKey || spokenScanKeyRef.current === scanKey) return undefined;

    let cancelled = false;
    spokenScanKeyRef.current = scanKey;

    function clearSpeechTimers() {
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(startTimerRef.current);
      retryTimerRef.current = null;
      startTimerRef.current = null;
    }

    function retryLater() {
      if (cancelled) return;
      clearSpeechTimers();
      retryTimerRef.current = window.setTimeout(() => speakOnce(), SPEECH_RETRY_DELAY_MS);
    }

    function speakOnce() {
      if (cancelled) return;
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

    speakOnce();

    return () => {
      cancelled = true;
      clearSpeechTimers();
    };
  }, [scan]);
}
