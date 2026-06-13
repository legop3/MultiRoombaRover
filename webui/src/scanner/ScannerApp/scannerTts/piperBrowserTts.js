// Piper Browser TTS Adapter
// Purpose: Runs scanner speech through Piper locally in the browser when available.
// Scope: Keeps the neural TTS package behind a dynamic import so non-scanner pages do not load it.

const PIPER_VOICE_ID = 'en_US-hfc_female-medium';
const PIPER_LIVE_TIMEOUT_MS = 900;

let piperModulePromise = null;
let currentAudio = null;
let currentObjectUrl = null;
let activeRequestId = 0;

function stopCurrentAudio() {
  if (currentAudio) {
    // Scanner labels should never overlap. Stop the previous clip before the
    // next scan speaks so audio always matches the current large display text.
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

async function loadPiperModule() {
  if (!piperModulePromise) {
    piperModulePromise = import('@mintplex-labs/piper-tts-web')
      .then((module) => {
        console.info('[scanner tts] Piper module ready');
        return module;
      })
      .catch((err) => {
        // Reset after failures so later scans can try again after a transient
        // model/CDN/cache issue. The hook falls back to browser speech for the
        // current scan rather than blocking the scanner interaction.
        piperModulePromise = null;
        throw err;
      });
  }
  return piperModulePromise;
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
      reject(new Error('Piper audio playback failed'));
    };
    audio.play().catch((err) => {
      if (currentAudio === audio) {
        stopCurrentAudio();
      }
      reject(err);
    });
  });
}

export async function speakWithPiper(text) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return false;
  const requestId = activeRequestId + 1;
  activeRequestId = requestId;

  try {
    const wavBlob = await Promise.race([
      loadPiperModule().then((piper) =>
        piper.predict(
          {
            text: cleanText,
            voiceId: PIPER_VOICE_ID,
          },
          (progress) => {
            // Piper stores downloaded models in the browser origin-private file
            // system. Console progress is enough for setup/debugging while the
            // rover-facing scanner screen stays uncluttered.
            if (progress?.url) {
              console.info('[scanner tts] Piper load', progress);
            }
          },
        ),
      ),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(null), PIPER_LIVE_TIMEOUT_MS);
      }),
    ]);
    if (!wavBlob || requestId !== activeRequestId) {
      return false;
    }
    await playBlob(wavBlob);
    return true;
  } catch (err) {
    console.warn('[scanner tts] Piper unavailable; falling back to browser speech', err);
    return false;
  }
}

export function stopPiperSpeech() {
  activeRequestId += 1;
  stopCurrentAudio();
}
