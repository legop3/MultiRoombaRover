// Barcode Scanner TTS Cache
// Purpose: Generates and caches scanner speech audio on the server with Kokoro.
// Scope: Keeps neural TTS completely outside the browser UI so scanner/audio experiments cannot freeze other web pages.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const logger = require('../../globals/logger').child('barcodeScannerTts');
const { resolveDataDir } = require('../../helpers/dataPaths');

const CACHE_DIR = path.join(resolveDataDir(), 'barcode-tts-cache');
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_OPTIONS = {
  // q8 keeps generation and model footprint smaller while preserving the voice
  // quality that worked well in the browser experiment. Server generation is
  // allowed to be slower than the scanner page, because cached files are reused.
  dtype: 'q8',
  device: 'cpu',
};
const VOICE_ID = 'af_bella';
const SPEED = 1;

let modelPromise = null;
const inFlightByText = new Map();

function normalizeSpeechText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cacheKeyForText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function cachePathForText(text) {
  return path.join(CACHE_DIR, `${cacheKeyForText(text)}.wav`);
}

async function loadModel() {
  if (!modelPromise) {
    modelPromise = import('kokoro-js')
      .then(async ({ KokoroTTS }) => {
        logger.info('Loading Kokoro scanner TTS model');
        const model = await KokoroTTS.from_pretrained(MODEL_ID, KOKORO_OPTIONS);
        logger.info('Kokoro scanner TTS model ready');
        return model;
      })
      .catch((err) => {
        // Reset after a failed load so a future scan can retry after a transient
        // model download or environment problem. Scanner clients will simply use
        // browser fallback when no server audio is available.
        modelPromise = null;
        throw err;
      });
  }
  return modelPromise;
}

async function readCachedAudio(text) {
  const filePath = cachePathForText(text);
  try {
    return await fsp.readFile(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to read scanner TTS cache file', { filePath, error: err.message });
    }
    return null;
  }
}

async function generateAudio(text) {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const model = await loadModel();
  const audio = await model.generate(text, {
    voice: VOICE_ID,
    speed: SPEED,
  });
  const wavBuffer = Buffer.from(audio.toWav());
  const filePath = cachePathForText(text);
  await fsp.writeFile(filePath, wavBuffer);
  return wavBuffer;
}

async function ensureAudioForText(text) {
  const cleanText = normalizeSpeechText(text);
  if (!cleanText) return null;

  const cached = await readCachedAudio(cleanText);
  if (cached) {
    return {
      cacheKey: cacheKeyForText(cleanText),
      mime: 'audio/wav',
      buffer: cached,
    };
  }

  if (!inFlightByText.has(cleanText)) {
    inFlightByText.set(
      cleanText,
      generateAudio(cleanText)
        .catch((err) => {
          logger.warn('Failed to generate scanner TTS audio', { text: cleanText, error: err.message });
          return null;
        })
        .finally(() => {
          inFlightByText.delete(cleanText);
        }),
    );
  }

  const generated = await inFlightByText.get(cleanText);
  if (!generated) return null;
  return {
    cacheKey: cacheKeyForText(cleanText),
    mime: 'audio/wav',
    buffer: generated,
  };
}

function warmAudioForTexts(texts = []) {
  const uniqueTexts = Array.from(new Set(texts.map(normalizeSpeechText).filter(Boolean)));
  if (!uniqueTexts.length) return;

  // Prewarming should never block server startup or barcode resolution. It just
  // fills the cache opportunistically so the scanner page usually receives an
  // already-generated wav blob at scan time.
  uniqueTexts.reduce(
    (chain, text) =>
      chain.then(async () => {
        try {
          await ensureAudioForText(text);
        } catch (err) {
          logger.warn('Scanner TTS prewarm failed', { text, error: err.message });
        }
      }),
    Promise.resolve(),
  );
}

function getCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

module.exports = {
  ensureAudioForText,
  warmAudioForTexts,
  getCacheDir,
};
