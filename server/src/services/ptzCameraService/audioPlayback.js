// PTZ Camera Audio Playback
// Purpose: Generates server-side TTS files and sends them to the Reolink TrackMix speaker through neolink.
// Scope: Owns file/cache/process details for PTZ speech only; PTZ ownership, chat identity, and camera motion stay in index.js.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { resolveDataDir } = require('../../helpers/dataPaths');

const DEFAULT_CAMERA_NAME = 'trackmix';
const DEFAULT_MEDIA_PORT = 9000;
const DEFAULT_NEOLINK_BIN = '/usr/local/bin/neolink';
const DEFAULT_CHROMEGTTS_WAV_BIN = '/usr/local/bin/chromegtts-wav';
const DEFAULT_ESPEAK_BIN = 'espeak';
const DEFAULT_FLITE_BIN = 'flite';
const DEFAULT_VOLUME = 0.7;
const MAX_TEXT_CHARS = 512;
const PLAYBACK_TIMEOUT_MS = 45000;

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function normalizeEngine(engine) {
  const value = String(engine || '').trim().toLowerCase();
  if (value === 'espeak' || value === 'e') return 'espeak';
  if (value === 'flite' || value === 'f') return 'flite';
  if (['chromegtts', 'googletts', 'gtts', 'google'].includes(value)) return 'chromegtts';
  return 'chromegtts';
}

function tomlString(value) {
  /*
    The generated neolink config is intentionally tiny, so JSON string escaping
    is enough for TOML basic strings and avoids pulling in a TOML writer just to
    persist four operator-configured values.
  */
  return JSON.stringify(String(value || ''));
}

function cacheKeyFor(text, ttsOptions) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ text, ttsOptions }))
    .digest('hex')
    .slice(0, 32);
}

function createPtzAudioPlayback(deps) {
  const {
    logger,
    cameraConfig,
    enabled,
    getSocketLabel,
  } = deps;

  const audioConfig = cameraConfig.audio || {};
  const audioEnabled = audioConfig.enabled === undefined ? Boolean(enabled) : Boolean(audioConfig.enabled);
  const dataRoot = path.join(resolveDataDir(), 'ptz-camera-audio');
  const cacheDir = path.join(dataRoot, 'tts-cache');
  const configPath = path.join(dataRoot, 'neolink-trackmix.toml');
  const cameraName = String(audioConfig.neolinkCameraName || DEFAULT_CAMERA_NAME).trim() || DEFAULT_CAMERA_NAME;
  const mediaPort = Number(audioConfig.mediaPort) || DEFAULT_MEDIA_PORT;
  const neolinkBin = String(audioConfig.neolinkBin || process.env.NEOLINK_BIN || DEFAULT_NEOLINK_BIN).trim();
  const chromegttsWavBin = String(
    audioConfig.chromegttsWavBin || process.env.CHROMEGTTS_WAV_BIN || DEFAULT_CHROMEGTTS_WAV_BIN,
  ).trim();
  const espeakBin = String(audioConfig.espeakBin || process.env.ESPEAK_BIN || DEFAULT_ESPEAK_BIN).trim();
  const fliteBin = String(audioConfig.fliteBin || process.env.FLITE_BIN || DEFAULT_FLITE_BIN).trim();
  const volume = clampNumber(audioConfig.volume, DEFAULT_VOLUME, 0, 4);
  const fliteDefaultVoice = String(audioConfig.fliteDefaultVoice || 'kal').trim();

  let playbackProc = null;
  let playbackSeq = 0;

  function getState() {
    return {
      enabled: audioEnabled,
      state: playbackProc ? 'playing' : 'idle',
      /*
        This state is sent to browser sessions through ptzCamera public state.
        Keep it operationally useful without leaking server filesystem layout or
        binary paths that are only meaningful to the Node process.
      */
      cameraName,
      volume,
    };
  }

  async function ensureNeolinkConfig() {
    await fsp.mkdir(dataRoot, { recursive: true });
    const host = String(cameraConfig.host || '').trim();
    const username = String(cameraConfig.username || '').trim();
    const password = String(cameraConfig.password || '');
    if (!host || !username || !password) {
      throw new Error('PTZ camera host/username/password required for audio playback');
    }

    const body = [
      'bind = "127.0.0.1"',
      '',
      '[[cameras]]',
      `name = ${tomlString(cameraName)}`,
      `username = ${tomlString(username)}`,
      `password = ${tomlString(password)}`,
      `address = ${tomlString(`${host}:${mediaPort}`)}`,
      'stream = "subStream"',
      '',
    ].join('\n');

    /*
      Write on every playback instead of trying to detect config drift. The file
      is small, and this guarantees a camera password/host change in config.yaml
      is reflected without an extra migration path or manual cleanup.
    */
    await fsp.writeFile(configPath, body, { mode: 0o600 });
    return configPath;
  }

  function spawnChecked(label, command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        ...options,
      });
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // noop
        }
      }, options.timeoutMs || PLAYBACK_TIMEOUT_MS);
      proc.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk || '')}`.slice(-4000);
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`${label} failed to start: ${err.message}`));
      });
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${label} exited code=${code} signal=${signal || 'none'} ${stderr.trim()}`.trim()));
      });
    });
  }

  async function renderEspeak(text, ttsOptions, filePath) {
    const args = ['-w', filePath];
    const pitch = clampNumber(ttsOptions.pitch, 50, 0, 99);
    if (pitch > 0) args.push('-p', String(Math.round(pitch)));
    args.push(text);
    await spawnChecked('espeak', espeakBin, args, { timeoutMs: 20000 });
  }

  async function renderFlite(text, ttsOptions, filePath) {
    const args = ['-o', filePath];
    const voice = String(ttsOptions.voice || fliteDefaultVoice || '').trim();
    if (voice) args.push('-voice', voice);
    args.push('-t', text);
    await spawnChecked('flite', fliteBin, args, { timeoutMs: 20000 });
  }

  async function renderChromeGoogleTts(text, ttsOptions, filePath) {
    const args = [
      '--text',
      text,
      '--voice',
      String(ttsOptions.voice || 'tpf'),
      '--pitch',
      String(clampNumber(ttsOptions.pitch, 1, 0.5, 2)),
      '--speed',
      String(clampNumber(ttsOptions.speed, 1, 0.5, 2)),
      '--output',
      filePath,
    ];
    await spawnChecked('chromegtts-wav', chromegttsWavBin, args, { timeoutMs: 30000 });
  }

  async function ensureTtsFile(text, rawOptions = {}) {
    const cleanText = normalizeText(text);
    if (!cleanText) throw new Error('PTZ TTS text required');
    const engine = normalizeEngine(rawOptions.engine);
    const ttsOptions = {
      engine,
      voice: typeof rawOptions.voice === 'string' ? rawOptions.voice.trim() : '',
      pitch: Number.isFinite(rawOptions.pitch) ? rawOptions.pitch : undefined,
      speed: Number.isFinite(rawOptions.speed) ? rawOptions.speed : undefined,
    };
    await fsp.mkdir(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, `${cacheKeyFor(cleanText, ttsOptions)}.wav`);
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isFile() && stat.size > 44) return { filePath, engine, cached: true };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp.wav`;
    /*
      Every renderer writes a normal WAV file. Neolink/GStreamer handles the
      final ADPCM talkback encoding that the Reolink camera expects, so the TTS
      renderer stays concerned only with faithfully matching the selected rover
      TTS engine's voice options.
    */
    if (engine === 'espeak') await renderEspeak(cleanText, ttsOptions, tmpPath);
    else if (engine === 'flite') await renderFlite(cleanText, ttsOptions, tmpPath);
    else await renderChromeGoogleTts(cleanText, ttsOptions, tmpPath);

    await fsp.rename(tmpPath, filePath);
    return { filePath, engine, cached: false };
  }

  function stopActivePlayback(reason = 'replace') {
    if (!playbackProc) return;
    const proc = playbackProc;
    playbackProc = null;
    logger.info('Stopping PTZ TTS playback', { reason, pid: proc.pid || null });
    try {
      proc.kill('SIGTERM');
    } catch {
      // noop
    }
    setTimeout(() => {
      if (proc.exitCode == null && proc.signalCode == null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // noop
        }
      }
    }, 1200);
  }

  async function playFile(filePath, context = {}) {
    if (!audioEnabled) throw new Error('PTZ audio disabled');
    const neolinkConfigPath = await ensureNeolinkConfig();
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error(`PTZ TTS file is not a regular file: ${filePath}`);

    stopActivePlayback('new-playback');
    const seq = ++playbackSeq;
    const args = [
      'talk',
      cameraName,
      '-c',
      neolinkConfigPath,
      '--volume',
      String(volume),
      '--file-path',
      filePath,
    ];
    const proc = spawn(neolinkBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    playbackProc = proc;
    let stderr = '';
    const timer = setTimeout(() => {
      if (playbackProc === proc) stopActivePlayback('timeout');
    }, PLAYBACK_TIMEOUT_MS);

    proc.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk || '')}`.slice(-4000);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (playbackProc === proc) playbackProc = null;
      logger.warn('PTZ TTS neolink spawn failed', { error: err.message, context });
    });
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (playbackProc === proc) playbackProc = null;
      if (code === 0 || signal === 'SIGTERM') {
        logger.info('PTZ TTS playback finished', { code, signal, context });
        return;
      }
      logger.warn('PTZ TTS playback failed', {
        code,
        signal,
        stderr: stderr.trim().slice(-1000),
        context,
      });
    });

    logger.info('PTZ TTS playback started', {
      pid: proc.pid || null,
      filePath,
      engine: context.engine || null,
      actor: context.socketId ? getSocketLabel(context.socketId) : null,
      seq,
    });
    return { pid: proc.pid || null, seq };
  }

  async function speakText(text, ttsOptions = {}, context = {}) {
    const rendered = await ensureTtsFile(text, ttsOptions);
    await playFile(rendered.filePath, {
      ...context,
      engine: rendered.engine,
      cached: rendered.cached,
    });
    return rendered;
  }

  return {
    getState,
    speakText,
    stopActivePlayback,
  };
}

module.exports = {
  createPtzAudioPlayback,
};
