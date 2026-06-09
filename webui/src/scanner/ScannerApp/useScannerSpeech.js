// Scanner Speech Hook
// Purpose: Speaks server-provided scan labels on the scanner computer.
// Scope: Keeps browser TTS as a local output device while leaving scan meaning and phrase selection on the server.
import { useEffect, useRef } from 'react';

const SPEECH_START_TIMEOUT_MS = 1500;
const SPEECH_RETRY_DELAY_MS = 700;
const PREFERRED_VOICE_PATTERN = /female|samantha|victoria|zira|karen|moira|serena|ava|susan|hazel|google uk english female/i;

function pickScannerVoice(synth) {
  const voices = typeof synth?.getVoices === 'function' ? synth.getVoices() : [];
  if (!voices.length) return null;

  const englishVoices = voices.filter((voice) => String(voice?.lang || '').toLowerCase().startsWith('en'));
  // Browser voice lists vary by operating system and installed speech packs, so
  // this is intentionally a preference rather than a requirement. A recognized
  // female-sounding English voice is best for the scanner speaker, but any
  // English voice is better than failing to speak, and the browser default is
  // the final fallback.
  return (
    englishVoices.find((voice) => PREFERRED_VOICE_PATTERN.test(String(voice?.name || ''))) ||
    voices.find((voice) => PREFERRED_VOICE_PATTERN.test(String(voice?.name || ''))) ||
    englishVoices[0] ||
    voices[0] ||
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
      utterance.rate = 0.92;
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
