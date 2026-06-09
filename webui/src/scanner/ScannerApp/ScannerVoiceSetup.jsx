// Scanner Voice Setup
// Purpose: Lets the scanner computer pick one exact browser TTS voice and store it locally.
// Scope: Keeps voice selection out of the rover-facing scanner screen while avoiding unreliable voice-name guessing.
import { useCallback, useEffect, useState } from 'react';
import { SCANNER_VOICE_STORAGE_KEY } from './useScannerSpeech.js';

function describeVoice(voice) {
  const parts = [voice?.name || 'unknown voice'];
  if (voice?.lang) parts.push(voice.lang);
  if (voice?.default) parts.push('default');
  return parts.join(' · ');
}

function speakVoiceSample(voice) {
  const synth = window.speechSynthesis;
  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;

  // Setup speech is intentionally direct and uncached. The operator is testing
  // individual installed voices, so each button should cancel the previous
  // sample and immediately speak with the candidate voice.
  synth.cancel();
  const utterance = new window.SpeechSynthesisUtterance('object 1');
  utterance.voice = voice;
  utterance.lang = voice?.lang || 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  synth.speak(utterance);
}

function readBrowserVoices() {
  const synth = window.speechSynthesis;
  return typeof synth?.getVoices === 'function' ? synth.getVoices() : [];
}

export default function ScannerVoiceSetup() {
  const [voices, setVoices] = useState(() => readBrowserVoices());
  const [selectedVoiceName, setSelectedVoiceName] = useState(() =>
    String(window.localStorage.getItem(SCANNER_VOICE_STORAGE_KEY) || '').trim(),
  );

  const refreshVoices = useCallback(() => {
    const nextVoices = readBrowserVoices();
    setVoices(nextVoices);
    // Logging the exact voice list is useful on Linux because Firefox exposes
    // whatever the system speech stack provides, and those names are the only
    // reliable identifiers we can save for later scanner sessions.
    console.info('[scanner voice setup] available voices', nextVoices.map(describeVoice));
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(refreshVoices, 0);
    const synth = window.speechSynthesis;
    if (!synth) {
      return () => {
        window.clearTimeout(refreshTimer);
      };
    }
    synth.addEventListener?.('voiceschanged', refreshVoices);
    synth.onvoiceschanged = refreshVoices;
    return () => {
      window.clearTimeout(refreshTimer);
      synth.removeEventListener?.('voiceschanged', refreshVoices);
      if (synth.onvoiceschanged === refreshVoices) {
        synth.onvoiceschanged = null;
      }
    };
  }, [refreshVoices]);

  const saveVoice = useCallback((voice) => {
    const voiceName = String(voice?.name || '').trim();
    if (!voiceName) return;
    window.localStorage.setItem(SCANNER_VOICE_STORAGE_KEY, voiceName);
    setSelectedVoiceName(voiceName);
    speakVoiceSample(voice);
  }, []);

  const clearVoice = useCallback(() => {
    window.localStorage.removeItem(SCANNER_VOICE_STORAGE_KEY);
    setSelectedVoiceName('');
    const synth = window.speechSynthesis;
    if (synth) synth.cancel();
  }, []);

  return (
    <main className="min-h-screen overflow-y-auto bg-black px-6 py-6 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-2 border-b border-white/30 pb-4">
          <h1 className="text-5xl font-black leading-none tracking-normal">scanner voice</h1>
          <p className="text-2xl leading-tight text-white">
            Pick the exact voice this scanner computer should use.
          </p>
          <p className="text-xl leading-tight text-white/80">
            Selected: {selectedVoiceName || 'automatic fallback'}
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="border-2 border-white bg-white px-4 py-3 text-2xl font-bold text-black"
            onClick={refreshVoices}
          >
            refresh voices
          </button>
          <button
            type="button"
            className="border-2 border-white px-4 py-3 text-2xl font-bold text-white"
            onClick={clearVoice}
          >
            use automatic fallback
          </button>
          <a
            className="border-2 border-white px-4 py-3 text-2xl font-bold text-white"
            href="/scanner"
          >
            back to scanner
          </a>
        </div>
        <section className="grid gap-3">
          {voices.length ? voices.map((voice) => {
            const selected = String(voice?.name || '') === selectedVoiceName;
            return (
              <article
                key={`${voice.name}-${voice.lang}`}
                className={`grid gap-3 border-2 p-4 ${selected ? 'border-white bg-white text-black' : 'border-white/50 bg-black text-white'}`}
              >
                <div className="text-3xl font-black leading-tight tracking-normal">
                  {describeVoice(voice)}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`border-2 px-4 py-3 text-2xl font-bold ${selected ? 'border-black text-black' : 'border-white text-white'}`}
                    onClick={() => speakVoiceSample(voice)}
                  >
                    test
                  </button>
                  <button
                    type="button"
                    className={`border-2 px-4 py-3 text-2xl font-bold ${selected ? 'border-black bg-black text-white' : 'border-white bg-white text-black'}`}
                    onClick={() => saveVoice(voice)}
                  >
                    select
                  </button>
                </div>
              </article>
            );
          }) : (
            <div className="border-2 border-white/50 p-4 text-3xl font-black">
              no browser voices loaded
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
