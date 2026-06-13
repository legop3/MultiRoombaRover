// Kokoro Browser TTS Adapter
// Purpose: Runs scanner speech through Kokoro.js locally in the browser when available.
// Scope: Keeps the heavy model dependency behind a dynamic import so non-scanner pages do not load it.

const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_OPTIONS = {
  // q8 is the practical first pass for a scanner station: much smaller than
  // fp32/fp16, still good enough for short object labels, and it runs on plain
  // WASM so Firefox does not need WebGPU support.
  dtype: 'q8',
  device: 'wasm',
};
const KOKORO_VOICE = 'af_bella';
const KOKORO_SPEED = 1;

let kokoroModelPromise = null;
let currentAudio = null;
let currentObjectUrl = null;

function stopCurrentAudio() {
  if (currentAudio) {
    // Scanner scans can arrive close together. Stop the previous generated clip
    // before starting the next one so the spoken label always matches the most
    // recent server scan state.
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

async function loadKokoroModel() {
  if (!kokoroModelPromise) {
    kokoroModelPromise = import('kokoro-js')
      .then(async ({ KokoroTTS }) => {
        console.info('[scanner tts] loading Kokoro model');
        const model = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
          ...KOKORO_OPTIONS,
          progress_callback: (progress) => {
            // The normal scanner page stays clean, but console progress is very
            // useful when first-load model downloads are slow on the scanner PC.
            if (progress?.status) {
              console.info('[scanner tts] Kokoro load', progress);
            }
          },
        });
        console.info('[scanner tts] Kokoro model ready');
        return model;
      })
      .catch((err) => {
        // Reset the promise after a failure so a later scan can retry. This is
        // important for first-load network hiccups while still letting the hook
        // fall back to browser speech immediately.
        kokoroModelPromise = null;
        throw err;
      });
  }
  return kokoroModelPromise;
}

function playBlob(blob) {
  stopCurrentAudio();
  currentObjectUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentObjectUrl);
  currentAudio.volume = 1;

  return new Promise((resolve, reject) => {
    const audio = currentAudio;
    audio.onended = () => {
      if (currentAudio === audio) {
        stopCurrentAudio();
      }
      resolve(true);
    };
    audio.onerror = () => {
      if (currentAudio === audio) {
        stopCurrentAudio();
      }
      reject(new Error('Kokoro audio playback failed'));
    };
    audio.play().catch((err) => {
      if (currentAudio === audio) {
        stopCurrentAudio();
      }
      reject(err);
    });
  });
}

export async function speakWithKokoro(text) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return false;

  try {
    const model = await loadKokoroModel();
    const audio = await model.generate(cleanText, {
      voice: KOKORO_VOICE,
      speed: KOKORO_SPEED,
    });
    await playBlob(audio.toBlob());
    return true;
  } catch (err) {
    console.warn('[scanner tts] Kokoro unavailable; falling back to browser speech', err);
    return false;
  }
}

export function stopKokoroSpeech() {
  stopCurrentAudio();
}
