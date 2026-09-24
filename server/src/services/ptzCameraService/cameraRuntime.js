// Owns one camera configuration's connections, media publisher and motion pipeline.
// Instances are retired on reconfiguration; their asynchronous work never owns
// the replacement instance's state or devices.
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { Cam } = require('onvif');
const { resolveRoverSnapshotDir } = require('../../helpers/dataPaths');
const { createPtzAudioPlayback } = require('./audioPlayback');

const PTZ_CAMERA_ID = 'ptz-camera';
const PTZ_STREAM_PATH = 'ptz-camera';
const DEFAULT_ONVIF_PORT = 8000;
const DEFAULT_PROFILE_TOKEN = '003';
// The TrackMix exposes pan/tilt and zoom through the same ONVIF method but does
// not behave as if they were the same kind of motor. Pan/tilt runs smoothly from
// one long ContinuousMove; zoom advances in command-sized increments. Keep the
// timings separate so zoom can repeat quickly without restarting pan/tilt.
const MOTION_WATCHDOG_MS = 650;
const PAN_TILT_TIMEOUT_MS = 10000;
const PAN_TILT_RENEW_MS = 8000;
const ZOOM_PULSE_TIMEOUT_MS = 1000;
const ZOOM_REPEAT_MS = 120;
const STOP_MOTION = Object.freeze({ pan: 0, tilt: 0, zoom: 0 });
const SNAPSHOT_DIR = resolveRoverSnapshotDir();
const SNAPSHOT_POLL_MS = 300;
const SPOTLIGHT_VERIFY_DELAY_MS = 1200;
const PUBLISHER_STDERR_SYNC_MS = 10000;
const PUBLISHER_RTSP_TIMEOUT_US = 10000000;


function createCameraRuntime({ cameraConfig, logger, events, onChange, getSocketLabel, startAfter = Promise.resolve() }) {
  let enabled = Boolean(cameraConfig.enabled);
  let retired = false;
  let initialization = null;
  const state = {
    initialized: false,
    initializing: false,
    error: null,
    profileToken: String(cameraConfig.profileToken || DEFAULT_PROFILE_TOKEN),
    rtspUri: null,
    streamPath: PTZ_STREAM_PATH,
    status: null,
    light: null,
    ir: null,
    presets: [],
    presetsError: null,
    publisher: {
      running: false,
      pid: null,
      startedAt: null,
      restartAt: null,
      restartCount: 0,
      exitCode: null,
      exitSignal: null,
      exitedAt: null,
      lastStderr: '',
      progress: null,
      lastEvent: 'idle',
    },
    reolinkApi: {
      connected: false,
      connecting: false,
      lastError: null,
      lastConnectedAt: null,
      lastEvent: 'idle',
    },
  };

  let onvifCam = null;
  let reolinkModulePromise = null;
  let publisherProcess = null;
  let publisherRestartTimer = null;
  let publisherStderrSyncTimer = null;
  let snapshotTimer = null;
  let spotlightVerifyTimer = null;
  let vendorStatePromise = Promise.resolve();
  let motionWatchdogTimer = null;
  let panTiltRenewTimer = null;
  let zoomRepeatTimer = null;
  let desiredMotion = STOP_MOTION;
  let pendingFullStopCommand = false;
  let pendingPanTiltCommand = false;
  let pendingZoomCommand = false;
  let motionCommandPromise = null;
  let lastSnapshotState = null;
  const audioPlayback = createPtzAudioPlayback({
    logger,
    cameraConfig,
    enabled,
    getSocketLabel,
  });


  function emitChange(reason) {
    if (!retired) onChange(reason);
  }

  function schedulePublisherStateSync(reason = 'publisher') {
    /*
      ffmpeg can print many warning/progress lines in bursts. Keep the latest text
      in state immediately, but debounce session sync so one noisy transcoder does
      not force every connected client to resync for each stderr chunk.
    */
    if (publisherStderrSyncTimer) return;
    publisherStderrSyncTimer = setTimeout(() => {
      publisherStderrSyncTimer = null;
      emitChange(reason);
    }, PUBLISHER_STDERR_SYNC_MS);
  }

  function updatePublisherState(patch = {}, reason = 'publisher') {
    state.publisher = {
      ...(state.publisher || {}),
      ...patch,
    };
    emitChange(reason);
  }

  function updateReolinkApiState(patch = {}, reason = 'reolink-api') {
    state.reolinkApi = {
      ...(state.reolinkApi || {}),
      ...patch,
    };
    emitChange(reason);
  }

  function parsePublisherProgressLine(line) {
    /*
      ffmpeg's "-progress pipe:2" emits simple key=value telemetry on stderr.
      Warning lines also arrive on stderr, so keep parsing narrow: only accept the
      known progress keys and let everything else remain user-visible stderr.
      This gives the UI enough signal to tell whether the transcoder is actually
      falling behind without flooding normal server logs.
    */
    const match = String(line || '').match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (!match) return false;
    const [, key, rawValue] = match;
    const allowed = new Set([
      'frame',
      'fps',
      'stream_0_0_q',
      'bitrate',
      'total_size',
      'out_time_us',
      'out_time_ms',
      'out_time',
      'dup_frames',
      'drop_frames',
      'speed',
      'progress',
    ]);
    if (!allowed.has(key)) return false;
    state.publisher = {
      ...(state.publisher || {}),
      progress: {
        ...(state.publisher?.progress || {}),
        [key]: rawValue,
        updatedAt: Date.now(),
      },
      lastEvent: 'progress',
    };
    return true;
  }

  function handlePublisherStderr(chunk) {
    const text = String(chunk || '').trim();
    if (!text) return;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const warningLines = [];

    lines.forEach((line) => {
      if (!parsePublisherProgressLine(line)) warningLines.push(line);
    });

    if (warningLines.length) {
      state.publisher = {
        ...(state.publisher || {}),
        lastStderr: warningLines.join('\n').slice(-1000),
        lastEvent: 'stderr',
      };
    }

    schedulePublisherStateSync(warningLines.length ? 'publisher-stderr' : 'publisher-progress');
  }

  function clampUnit(value) {
    const number = Number(value) || 0;
    return Math.max(-1, Math.min(1, number));
  }

  function spotlightCameraStateForLogicalOn(logicalOn) {
    return Boolean(logicalOn) ? 1 : 0;
  }

  function normalizeSpotlightState(light) {
    if (!light || typeof light !== 'object') return light || null;
    return { ...light, on: isSpotlightOn(light) };
  }

  function isSpotlightOn(light = {}) {
    const raw = light?.state;
    let rawOn = false;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      rawOn = !['', '0', 'off', 'false'].includes(normalized);
    } else {
      rawOn = Boolean(Number(raw));
    }
    return rawOn;
  }

  function normalizeSpotlightPayloadState(rawState) {
    /*
      Socket payloads can arrive as booleans, numbers, or strings depending on
      which control path produced them. Boolean("0") is true in JavaScript, so do
      an explicit conversion here before building the Reolink payload.
    */
    if (typeof rawState === 'string') {
      const normalized = rawState.trim().toLowerCase();
      if (['1', 'on', 'true', 'yes'].includes(normalized)) return true;
      if (['0', 'off', 'false', 'no'].includes(normalized)) return false;
    }
    return Boolean(Number(rawState));
  }

  function normalizeIrState(rawState) {
    /*
      Reolink accepts exactly Auto, On, and Off for this camera's IR LED control.
      Normalize UI payloads at the server boundary so keyboard, mobile, and any
      future direct socket callers all hit the same camera API contract.
    */
    const normalized = String(rawState || '').trim().toLowerCase();
    if (normalized === 'on' || normalized === '1' || normalized === 'true') return 'On';
    if (normalized === 'off' || normalized === '0' || normalized === 'false') return 'Off';
    return 'Auto';
  }

  function callOnvif(method, options = {}) {
    return new Promise((resolve, reject) => {
      if ((retired && method !== 'stop') || !onvifCam || typeof onvifCam[method] !== 'function') {
        reject(new Error('ONVIF camera is not ready'));
        return;
      }
      onvifCam[method](options, (err, data) => {
        if (retired && method !== 'stop') reject(new Error('PTZ configuration changed'));
        else if (err) reject(err);
        else resolve(data);
      });
    });
  }

  function normalizePresetName(rawName, token) {
    /*
      ONVIF cameras are inconsistent about preset names. Some return a readable
      Name field, some return name, and some only return the token. The browser
      needs a stable label for every button, so fall back to the token only after
      exhausting the human-facing fields the camera may provide.
    */
    const name = String(rawName || '').trim();
    if (name) return name;
    const tokenLabel = String(token || '').trim();
    return tokenLabel ? `Preset ${tokenLabel}` : 'Unnamed preset';
  }

  function normalizeOnvifPreset(entry, fallbackToken = '') {
    /*
      The onvif package returns camera XML converted to plain objects, but exact
      key casing can vary by device and service response. Normalize once at the
      service boundary so UI and socket callers never depend on vendor-specific
      field names.
    */
    if (!entry || typeof entry !== 'object') return null;
    const token = String(entry.token || entry.$?.token || entry.presetToken || entry.PresetToken || fallbackToken || '').trim();
    if (!token) return null;
    return {
      token,
      name: normalizePresetName(entry.name || entry.Name, token),
    };
  }

  function normalizeOnvifPresets(raw) {
    /*
      getPresets can come back as an array directly, as { presets }, or as nested
      ONVIF response data depending on the library/device pairing. Keep this
      intentionally permissive because a missing preset list should degrade to an
      empty panel, not a broken PTZ session.
    */
    const candidates = Array.isArray(raw)
      ? raw.map((entry) => [null, entry])
      : Array.isArray(raw?.presets)
      ? raw.presets.map((entry) => [null, entry])
      : Array.isArray(raw?.Presets)
      ? raw.Presets.map((entry) => [null, entry])
      : Array.isArray(raw?.GetPresetsResponse?.Preset)
      ? raw.GetPresetsResponse.Preset.map((entry) => [null, entry])
      : Array.isArray(raw?.Preset)
      ? raw.Preset.map((entry) => [null, entry])
      : raw && typeof raw === 'object'
      ? Object.entries(raw)
      : [];
    return candidates
      .map(([fallbackToken, entry]) => normalizeOnvifPreset(entry, fallbackToken))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async function refreshPresets(reason = 'presets', ready = false) {
    /*
      The camera owns preset storage. Reading it back after every create/delete
      keeps this server stateless and avoids a local JSON store drifting away from
      what ONVIF will actually accept for gotoPreset.
    */
    if (!ready) await initialize();
    try {
      const raw = await callOnvif('getPresets', { profileToken: state.profileToken });
      state.presets = normalizeOnvifPresets(raw);
      state.presetsError = null;
    } catch (err) {
      state.presets = [];
      state.presetsError = err.message || String(err);
      logger.warn('Failed to refresh PTZ presets', { error: state.presetsError });
    }
    emitChange(reason);
    return state.presets;
  }

  function connectOnvif() {
    return new Promise((resolve, reject) => {
      const cam = new Cam({
        hostname: cameraConfig.host,
        username: cameraConfig.username,
        password: cameraConfig.password,
        port: Number(cameraConfig.onvifPort) || DEFAULT_ONVIF_PORT,
        timeout: 10000,
      }, function handleConnect(err) {
        if (err) reject(err);
        else resolve(this);
      });
      return cam;
    });
  }

  async function getStreamUriForProfile(cam) {
    const profileToken = String(cameraConfig.profileToken || DEFAULT_PROFILE_TOKEN);
    return new Promise((resolve, reject) => {
      cam.getStreamUri({ profileToken, protocol: 'RTSP' }, (err, data) => {
        if (err) reject(err);
        else resolve(data?.uri || data?.Uri || '');
      });
    });
  }

  function addCredentialsToRtsp(rawUri) {
    const parsed = new URL(rawUri);
    if (!parsed.username) parsed.username = cameraConfig.username;
    if (!parsed.password) parsed.password = cameraConfig.password;
    return parsed.toString();
  }

  function stopPublisher() {
    if (publisherRestartTimer) {
      clearTimeout(publisherRestartTimer);
      publisherRestartTimer = null;
    }
    if (publisherProcess) {
      try {
        publisherProcess.kill('SIGTERM');
      } catch {}
      publisherProcess = null;
    }
    updatePublisherState({
      running: false,
      pid: null,
      restartAt: null,
      lastEvent: 'stopped',
    }, 'publisher-stop');
  }

  function schedulePublisherRestart(reason = 'publisher-restart') {
    /*
      The publisher's recovery rule is intentionally simple: ffmpeg owns the RTSP
      connection, and this service starts a fresh process whenever that connection
      causes ffmpeg to exit. Clearing any existing timer first prevents a burst of
      quick exits from scheduling multiple competing replacement publishers.
    */
    if (!enabled || !state.rtspUri) return null;
    if (publisherRestartTimer) {
      clearTimeout(publisherRestartTimer);
      publisherRestartTimer = null;
    }
    const restartAt = Date.now() + 1500;
    publisherRestartTimer = setTimeout(() => {
      publisherRestartTimer = null;
      startPublisher();
    }, 1500);
    updatePublisherState({
      restartAt,
      restartCount: Number(state.publisher?.restartCount || 0) + 1,
      lastEvent: reason,
    }, 'publisher-restart-scheduled');
    return restartAt;
  }

  function startPublisher() {
    if (!enabled || !state.rtspUri || publisherProcess) return;
    const input = addCredentialsToRtsp(state.rtspUri);
    const output = `rtsp://127.0.0.1:8554/${encodeURIComponent(PTZ_STREAM_PATH)}`;
    /*
      The full-quality autotrack profile is H265, which is the right camera-side
      feed but has been unreliable through browser WHEP playback. Re-encoding is
      intentionally kept here, at the single camera publisher boundary, so the
      rest of the video auth/session/UI code still sees one normal MediaMTX path.

      The camera audio is AAC LC at 16 kHz mono. Keep it inline with the video so
      the PTZ camera remains one MediaMTX/WHEP source, but transcode it to Opus
      because that is the WebRTC-friendly audio codec browsers should negotiate
      through MediaMTX. This avoids creating a rover-style separate audio stream
      for a camera that already provides synchronized audio in the RTSP feed.

      These encoder settings trade compression efficiency for control latency:
      ultrafast avoids deep analysis, zerolatency disables x264 buffering, bf=0
      removes B-frames, and the 20-frame GOP matches the camera's observed 20fps
      autotrack stream so the browser gets frequent keyframes without forcing a
      huge bitrate spike. The explicit x264 params turn off lookahead buffering
      that is useful for compression quality but harmful when the camera is being
      driven live. Sliced threads allow x264 to keep some parallelism without
      waiting on future frames the way normal frame-threading can.

      Keep RTSP demuxing conservative here. More aggressive "drop stale frames"
      flags caused this camera stream to freeze after running for a while, so the
      safer latency knob is to keep the encoder light and avoid building delay
      inside x264 itself.

      The camera can restart while ffmpeg keeps its old TCP/RTSP session open and
      continues publishing a useless black output stream. The timeout options are
      input-side failure detectors: when the RTSP socket stops producing usable
      reads for long enough, ffmpeg should exit instead of staying attached to the
      dead session. The existing exit handler then starts a new process, which is
      the part that creates a fresh RTSP connection after the camera comes back.

      The MediaMTX output uses RTSP over TCP, matching every rover publisher and
      server-local reader. Keeping one media transport avoids the incompatible
      empty SRT ACKACK packets produced between GoSRT and Fedora's newer libSRT.
    */
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostdin',
      '-progress',
      'pipe:2',
      '-stats_period',
      '2',
      '-fflags',
      'nobuffer',
      '-flags',
      'low_delay',
      '-rtsp_transport',
      'tcp',
      '-timeout',
      String(PUBLISHER_RTSP_TIMEOUT_US),
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-threads',
      '8',
      '-x264-params',
      'sliced-threads=1:sync-lookahead=0:rc-lookahead=0:keyint=20:min-keyint=20:scenecut=0',
      '-bf',
      '0',
      '-g',
      '20',
      '-keyint_min',
      '20',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      '-application',
      'lowdelay',
      '-frame_duration',
      '10',
      '-b:a',
      '32k',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-strict',
      '-2',
      '-flush_packets',
      '1',
      '-rtsp_transport',
      'tcp',
      '-f',
      'rtsp',
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    publisherProcess = proc;
    updatePublisherState({
      running: true,
      pid: proc.pid || null,
      startedAt: Date.now(),
      restartAt: null,
      exitCode: null,
      exitSignal: null,
      exitedAt: null,
      lastEvent: 'started',
    }, 'publisher-start');
    proc.stderr.on('data', (chunk) => {
      if (publisherProcess === proc && !retired) handlePublisherStderr(chunk);
    });
    proc.on('error', (err) => {
      if (!retired) logger.warn('PTZ publisher failed', { error: err.message });
    });
    proc.on('exit', (code, signal) => {
      if (publisherProcess !== proc || retired) return;
      publisherProcess = null;
      logger.warn('publisher exited', { code, signal, lastStderr: state.publisher?.lastStderr || null });
      const restartAt = enabled && state.rtspUri ? Date.now() + 1500 : null;
      updatePublisherState({
        running: false,
        pid: null,
        restartAt,
        exitCode: code,
        exitSignal: signal,
        exitedAt: Date.now(),
        lastEvent: restartAt ? 'restarting' : 'exited',
      }, 'publisher-exit');
      if (restartAt) schedulePublisherRestart('restarting');
    });
    logger.info('Started PTZ stream publisher', { streamPath: PTZ_STREAM_PATH, encoder: 'libx264' });
  }

  function getErrorMessage(err) {
    return err?.message || String(err || 'unknown error');
  }

  async function closeReolinkClient(client, reason = 'reset') {
    /*
      Each Reolink operation owns a short-lived long-mode session. close() logs
      out and frees any SDK resources; cleanup failures are logged at debug level
      because the command result has already been determined by the time finally
      cleanup runs.
    */
    if (!client || typeof client.close !== 'function') return;
    try {
      await client.close();
    } catch (err) {
      logger.debug?.('Reolink client close failed', { reason, error: getErrorMessage(err) });
    }
  }

  async function createReolinkClientSession() {
    /*
      reolink-nvr-api is published as an ESM-only package. This server is still
      CommonJS, so a top-level require() fails before the service can even start.
      Dynamic import keeps the server bootable while still creating a fresh camera
      API client for every command. Avoiding a cached long-lived client keeps one
      wedged Reolink session from poisoning later light/IR commands.
    */
    if (!reolinkModulePromise) {
      reolinkModulePromise = import('reolink-nvr-api');
    }
    const { ReolinkClient } = await reolinkModulePromise;
    if (retired) throw new Error('PTZ configuration changed');
    const client = new ReolinkClient({
      host: cameraConfig.host,
      username: cameraConfig.username,
      password: cameraConfig.password,
      mode: 'long',
      insecure: true,
      timeout: 10000,
    });
    await client.login();
    updateReolinkApiState({
      connected: true,
      connecting: false,
      lastError: null,
      lastConnectedAt: Date.now(),
      lastEvent: 'connected',
    }, 'reolink-api-connected');
    return client;
  }

  async function callReolinkApi(command, payload = {}, authorize = () => {}) {
    /*
      Commands should not depend on the previous command's session or observed
      state. Open a fresh Reolink session, send exactly the requested API command,
      and close it. If the camera rejects or ignores the command, the failure is
      allowed to surface to the caller instead of being hidden behind retries that
      can make the UI look successful while the physical emitter never changed.
    */
    if (!enabled) throw new Error('PTZ camera disabled');
    updateReolinkApiState({
      connected: false,
      connecting: true,
      lastEvent: 'connecting',
    }, 'reolink-api-connecting');
    let client = null;
    try {
      authorize();
      client = await createReolinkClientSession();
      if (retired) throw new Error('PTZ configuration changed');
      authorize();
      const result = await client.api(command, payload);
      if (retired) throw new Error('PTZ configuration changed');
      updateReolinkApiState({
        connected: false,
        connecting: false,
        lastError: null,
        lastConnectedAt: Date.now(),
        lastEvent: 'api-ok-closed',
      }, 'reolink-api-ok');
      return result;
    } catch (err) {
      const message = getErrorMessage(err);
      updateReolinkApiState({
        connected: false,
        connecting: false,
        lastError: message,
        lastEvent: 'api-error',
      }, 'reolink-api-error');
      logger.warn('Reolink API command failed', { command, error: message });
      throw err;
    } finally {
      await closeReolinkClient(client, `api:${command}`);
    }
  }

  async function refreshVendorState() {
    if (!enabled) return;
    /*
      Read these sequentially so the camera sees one fresh-session API request at
      a time. Parallel reads are not useful here, and avoiding overlap keeps the
      vendor API behavior easier to reason about when it is already acting flaky.
    */
    const white = await callReolinkApi('GetWhiteLed', { channel: 0 });
    const ir = await callReolinkApi('GetIrLights', { channel: 0 });
    state.light = normalizeSpotlightState(white?.WhiteLed || white || null);
    state.ir = ir?.IrLights || ir || null;
  }

  async function refreshSpotlightState() {
    const white = await callReolinkApi('GetWhiteLed', { channel: 0 });
    state.light = normalizeSpotlightState(white?.WhiteLed || white || null);
    emitChange('light');
    return state.light;
  }

  function scheduleSpotlightVerification() {
    /*
      This camera acknowledges SetWhiteLed before GetWhiteLed catches up. A read
      immediately after a successful write returns the old value for roughly one
      second, which made the UI appear inverted or flaky. Replace any pending
      verification with one delayed read so rapid toggles settle on the newest
      requested state instead of racing stale camera state back into the session.
    */
    if (spotlightVerifyTimer) {
      clearTimeout(spotlightVerifyTimer);
      spotlightVerifyTimer = null;
    }
    spotlightVerifyTimer = setTimeout(() => {
      spotlightVerifyTimer = null;
      serializeVendorState(() => refreshSpotlightState()).catch((err) => {
        logger.warn('spotlight verification failed', { error: err.message });
      });
    }, SPOTLIGHT_VERIFY_DELAY_MS);
  }

  function serializeVendorState(operation) {
    /*
      The Reolink HTTP API can return stale light state when reads and writes are
      overlapped. Keep spotlight/IR changes in one narrow queue so a button mash
      becomes ordered camera operations instead of competing Get/Set requests.
    */
    vendorStatePromise = vendorStatePromise
      .catch(() => {})
      .then(() => {
        if (retired) throw new Error('PTZ configuration changed');
        return operation();
      });
    return vendorStatePromise;
  }

  function initialize() {
    if (retired || !enabled) return Promise.reject(new Error('PTZ camera unavailable'));
    if (state.initialized) return Promise.resolve();
    if (initialization) return initialization;
    state.initializing = true;
    initialization = (async () => {
      try {
        // A replacement waits for the old camera's serialized safety stop.
        await startAfter;
        if (retired) throw new Error('PTZ configuration changed');
        const cam = await connectOnvif();
        if (retired) throw new Error('PTZ configuration changed');
        onvifCam = cam;
        const uri = await getStreamUriForProfile(cam);
        if (retired) throw new Error('PTZ configuration changed');
        state.rtspUri = uri;
        await refreshPresets('initialize-presets', true);
        if (retired) throw new Error('PTZ configuration changed');
        state.initialized = true;
        state.error = null;
        startPublisher();
        startSnapshotPolling();
        serializeVendorState(() => refreshVendorState()).catch((err) => {
          if (!retired) logger.warn('initial Reolink state refresh failed', { error: getErrorMessage(err) });
        });
      } catch (err) {
        if (!retired) state.error = getErrorMessage(err);
        throw err;
      } finally {
        state.initializing = false;
        initialization = null;
        emitChange('initialize');
      }
    })();
    return initialization;
  }

  function normalizePresetToken(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) throw new Error('Preset token is required');
    if (/[<>&'"]/.test(token)) throw new Error('Preset token contains invalid characters');
    return token;
  }

  function escapeOnvifXmlText(value) {
    /*
      The installed onvif package writes option values directly into SOAP XML.
      Escape admin-entered preset names before handing them to the package so a
      normal label like "Door & window" remains valid XML instead of corrupting
      the SetPreset request body.
    */
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function normalizePresetCreateName(rawName) {
    /*
      The ONVIF API stores the preset at the camera's current position. A clear
      name is the only context future users get in the UI, so require a small
      non-empty label instead of silently creating "undefined" camera presets.
    */
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Preset name is required');
    if (name.length > 60) throw new Error('Preset name must be 60 characters or less');
    return name;
  }

  function normalizeMotionIntent(payload = {}) {
    return {
      pan: clampUnit(payload.pan ?? payload.x),
      tilt: clampUnit(payload.tilt ?? payload.y),
      zoom: clampUnit(payload.zoom),
    };
  }

  function isMotionIdle(motion = STOP_MOTION) {
    return !motion.pan && !motion.tilt && !motion.zoom;
  }

  function clearMotionWatchdog() {
    if (!motionWatchdogTimer) return;
    clearTimeout(motionWatchdogTimer);
    motionWatchdogTimer = null;
  }

  function clearPanTiltRenewal() {
    if (!panTiltRenewTimer) return;
    clearTimeout(panTiltRenewTimer);
    panTiltRenewTimer = null;
  }

  function clearZoomRepeat() {
    if (!zoomRepeatTimer) return;
    clearInterval(zoomRepeatTimer);
    zoomRepeatTimer = null;
  }

  function panTiltMatches(left = STOP_MOTION, right = STOP_MOTION) {
    return left.pan === right.pan && left.tilt === right.tilt;
  }

  function requestMotionCommands({ fullStop = false, panTilt = false, zoom = false } = {}) {
    pendingFullStopCommand = pendingFullStopCommand || fullStop;
    pendingPanTiltCommand = pendingPanTiltCommand || panTilt;
    pendingZoomCommand = pendingZoomCommand || zoom;
    if (
      motionCommandPromise ||
      (!pendingFullStopCommand && !pendingPanTiltCommand && !pendingZoomCommand)
    ) {
      return motionCommandPromise || Promise.resolve();
    }

    /*
      Keep one ONVIF request in flight at a time, but coalesce independently by
      axis. A zoom timer can tick several times while the camera answers one SOAP
      request; one pending boolean preserves the newest required pulse without
      building a delayed command backlog that would continue after release.
    */
    motionCommandPromise = (async () => {
      while (pendingFullStopCommand || pendingPanTiltCommand || pendingZoomCommand) {
        const sendFullStop = pendingFullStopCommand;
        pendingFullStopCommand = false;
        if (sendFullStop) {
          try {
            /*
              Reserve ONVIF Stop for real all-axis safety events. The TrackMix
              appears to treat even an axis-filtered Stop as global, so ordinary
              user releases below use zero velocity instead.
            */
            await callOnvif('stop', {
              profileToken: state.profileToken,
              panTilt: true,
              zoom: true,
            });
          } catch (err) {
            logger.warn('PTZ full stop command failed', { error: getErrorMessage(err) });
          }
        }

        const sendPanTilt = pendingPanTiltCommand;
        pendingPanTiltCommand = false;
        if (sendPanTilt) {
          const pan = desiredMotion.pan;
          const tilt = desiredMotion.tilt;
          try {
            await initialize();
            if (!pan && !tilt) {
              /*
                Zero pan/tilt velocity stops only that axis under ContinuousMove.
                Do not use ONVIF Stop here: this TrackMix ignores the requested
                axis filter and can also stop zoom that is still being held.
              */
              await callOnvif('continuousMove', {
                profileToken: state.profileToken,
                x: 0,
                y: 0,
                onlySendPanTilt: true,
                timeout: PAN_TILT_TIMEOUT_MS,
              });
            } else {
              await callOnvif('continuousMove', {
                profileToken: state.profileToken,
                x: pan,
                y: tilt,
                onlySendPanTilt: true,
                timeout: PAN_TILT_TIMEOUT_MS,
              });
            }
          } catch (err) {
            logger.warn('PTZ pan/tilt command failed', { error: getErrorMessage(err), pan, tilt });
          }
        }

        const sendZoom = pendingZoomCommand;
        pendingZoomCommand = false;
        if (sendZoom) {
          const zoom = desiredMotion.zoom;
          try {
            await initialize();
            if (zoom) {
              /*
                The TrackMix does not advertise continuous zoom, but physical
                testing showed each accepted zoom-only ContinuousMove advances one
                step. Repeating this axis-only request restores responsive zoom
                without resending or restarting the pan/tilt motor.
              */
              await callOnvif('continuousMove', {
                profileToken: state.profileToken,
                zoom,
                onlySendZoom: true,
                timeout: ZOOM_PULSE_TIMEOUT_MS,
              });
            }
          } catch (err) {
            logger.warn('PTZ zoom command failed', { error: getErrorMessage(err), zoom });
          }
        }
      }
    })().finally(() => {
      motionCommandPromise = null;
      // Cover an intent arriving between the loop check and promise cleanup.
      if (pendingFullStopCommand || pendingPanTiltCommand || pendingZoomCommand) {
        requestMotionCommands();
      }
    });

    return motionCommandPromise;
  }

  function armPanTiltRenewal() {
    clearPanTiltRenewal();
    if (!desiredMotion.pan && !desiredMotion.tilt) return;
    /*
      The camera requires a finite timeout. Renew close to the ten-second limit,
      not on every browser heartbeat, so an unusually long hold stays continuous
      without bringing back the quarter-second motor restarts.
    */
    panTiltRenewTimer = setTimeout(() => {
      panTiltRenewTimer = null;
      requestMotionCommands({ panTilt: true });
      armPanTiltRenewal();
    }, PAN_TILT_RENEW_MS);
  }

  function syncZoomRepeater() {
    clearZoomRepeat();
    if (!desiredMotion.zoom) return;
    // queueMotionIntent sends the first step once after configuring this timer;
    // subsequent ticks retain the old fast hold cadence without a double pulse.
    zoomRepeatTimer = setInterval(() => {
      requestMotionCommands({ zoom: true });
    }, ZOOM_REPEAT_MS);
  }

  function queueMotionIntent(motion, reason = 'input') {
    const nextMotion = normalizeMotionIntent(motion);
    const panTiltChanged = !panTiltMatches(nextMotion, desiredMotion);
    const zoomChanged = nextMotion.zoom !== desiredMotion.zoom;
    desiredMotion = nextMotion;
    clearMotionWatchdog();

    if (!isMotionIdle(nextMotion)) {
      /*
        Socket disconnect normally arrives quickly, but it is not a suitable motor
        safety boundary. Every non-zero browser heartbeat replaces this timer; if
        releases or subsequent heartbeats disappear, the server injects a zero
        intent into the same serialized stream as ordinary control changes.
      */
      motionWatchdogTimer = setTimeout(() => {
        motionWatchdogTimer = null;
        queueMotionIntent(STOP_MOTION, 'watchdog');
      }, MOTION_WATCHDOG_MS);
    }

    /*
      Identical browser heartbeats refresh only the watchdog. They must not touch
      either motor scheduler: pan/tilt already has a long continuous command, and
      zoom has its own 120 ms axis-only repeater.
    */
    const sendPanTilt = panTiltChanged;
    /*
      A live-camera recording proved that both Stop(Zoom=true) and a zero-velocity
      zoom ContinuousMove halt pan/tilt on this firmware. Zoom itself is step-based:
      each non-zero pulse advances once and then settles. Releasing zoom therefore
      means clearing its timer and any coalesced-but-unsent pulse, with no camera
      command at all. The last transmitted pulse retains its finite one-second
      timeout as a backstop.
    */
    if (zoomChanged && !nextMotion.zoom) pendingZoomCommand = false;
    const sendZoom = Boolean(nextMotion.zoom) && zoomChanged;
    if (sendPanTilt) armPanTiltRenewal();
    if (sendZoom) syncZoomRepeater();
    if (zoomChanged && !nextMotion.zoom) clearZoomRepeat();
    const pending = requestMotionCommands({ panTilt: sendPanTilt, zoom: sendZoom });
    pending.catch(() => {});
    return { ok: true, motion: desiredMotion, reason };
  }

  function forceMotionStop(reason = 'safety-stop') {
    /*
      Lifecycle stops force a real all-axis ONVIF Stop even when local state is
      already zero. The browser may have lost its final packet, or the camera may
      have accepted a command whose response has not returned, so deduplicating a
      safety stop would trust precisely the state we are trying to recover from.
    */
    clearPanTiltRenewal();
    clearZoomRepeat();
    queueMotionIntent(STOP_MOTION, reason);
    requestMotionCommands({ fullStop: true });
    return motionCommandPromise || Promise.resolve();
  }

  async function getStatus() {
    await initialize();
    const status = await callOnvif('getStatus', { profileToken: state.profileToken });
    state.status = status || null;
    emitChange('status');
    return state.status;
  }

  async function listPresets() {
    return refreshPresets('presets-list');
  }

  async function gotoPreset(payload = {}, authorize = () => {}) {
    await initialize();
    const presetToken = normalizePresetToken(payload.token || payload.presetToken);
    /*
      Stop any continuous move before jumping to a preset. Without this, a held
      key or touch control can keep sending pan/tilt velocity while the camera is
      trying to execute the absolute preset move, which makes the final position
      feel inconsistent. Await the serialized safety stop instead of issuing a
      raw concurrent ONVIF request that could itself race an older movement.
    */
    authorize();
    await forceMotionStop('preset').catch(() => {});
    authorize();
    await callOnvif('gotoPreset', {
      profileToken: state.profileToken,
      /*
        This onvif package names the goto option "preset" even though it writes
        that value into the ONVIF PresetToken XML element. Keep the local variable
        named presetToken because that is what the camera and UI are actually
        handling, but send the package's expected option name here.
      */
      preset: presetToken,
    });
    return { ok: true, presetToken };
  }

  async function createPreset(payload = {}, authorize = () => {}) {
    await initialize();
    const presetName = normalizePresetCreateName(payload.name || payload.presetName);
    const options = {
      profileToken: state.profileToken,
      presetName: escapeOnvifXmlText(presetName),
    };
    /*
      ONVIF setPreset updates an existing token when one is supplied and creates a
      new preset when it is omitted. Support both so the UI can start simple with
      "create current position" and later reuse the same server action for rename
      or overwrite workflows if needed.
    */
    const rawPresetToken = String(payload.token || payload.presetToken || '').trim();
    const presetToken = rawPresetToken ? normalizePresetToken(rawPresetToken) : '';
    if (presetToken) options.presetToken = presetToken;
    authorize();
    const result = await callOnvif('setPreset', options);
    const presets = await refreshPresets('preset-create');
    return {
      ok: true,
      presetToken: result?.presetToken || result?.PresetToken || presetToken || null,
      presets,
    };
  }

  async function removePreset(payload = {}, authorize = () => {}) {
    await initialize();
    const presetToken = normalizePresetToken(payload.token || payload.presetToken);
    authorize();
    await callOnvif('removePreset', {
      profileToken: state.profileToken,
      presetToken,
    });
    return {
      ok: true,
      presetToken,
      presets: await refreshPresets('preset-remove'),
    };
  }

  async function setSpotlight(payload = {}, authorize = () => {}) {
    return serializeVendorState(async () => {
      let current = state.light ? normalizeSpotlightState(state.light) : null;
      if (payload.state === undefined && !current) {
        /*
          Toggle requests need a base state. Normal button paths send an explicit
          state, so this read only happens for rare generic toggle callers or
          startup races before the initial vendor state has arrived.
        */
        current = await refreshSpotlightState();
      }
      const logicalOn = payload.state === undefined
        ? !isSpotlightOn(current || {})
        : normalizeSpotlightPayloadState(payload.state);
      const cameraState = spotlightCameraStateForLogicalOn(logicalOn);
      const cameraPayload = {
        channel: 0,
        state: cameraState,
      };
      const next = {
        ...(current || {}),
        ...cameraPayload,
        on: logicalOn,
      };
      if (Number.isFinite(Number(payload.bright))) {
        const bright = Math.max(0, Math.min(100, Number(payload.bright)));
        cameraPayload.bright = bright;
        next.bright = bright;
      }
      /*
        Send the explicit requested state through a fresh API session before
        changing public state. If the camera/API rejects the command, the UI should
        not be left showing an optimistic state that never reached the device.
      */
      await callReolinkApi('SetWhiteLed', { WhiteLed: cameraPayload }, authorize);
      state.light = next;
      emitChange('light');
      scheduleSpotlightVerification();
      return state.light;
    });
  }

  async function setIr(payload = {}, authorize = () => {}) {
    return serializeVendorState(async () => {
      const nextState = normalizeIrState(payload.state);
      /*
        The camera requires channel inside IrLights. Without it, SetIrLights
        returns param error (-4), while the optimistic local state makes the UI
        look like the command worked. Keep the optimistic state, but send the
        minimal payload the camera actually accepts.
      */
      const next = { ...(state.ir || {}), channel: 0, state: nextState };
      /*
        As with spotlight, update session state after the fresh-session command
        succeeds so a rejected Reolink request does not make the UI claim the IR
        mode changed when the camera never accepted it.
      */
      await callReolinkApi('SetIrLights', { IrLights: { channel: 0, state: nextState } }, authorize);
      state.ir = next;
      emitChange('ir');
      await refreshVendorState();
      return state.ir;
    });
  }

  async function disableEmittersForIdle() {
    /*
      Idle cleanup is a server-owned safety action, not a user control action, so
      it intentionally does not go through requireOperator(). If nobody is using
      the camera, the system still needs a way to leave every camera-side emitter
      in a known off state.
    */
    if (!enabled) {
      return { action: 'disablePtzEmitters', skipped: true, reason: 'ptzDisabled' };
    }

    await initialize();
    if (!state.initialized) {
      return {
        action: 'disablePtzEmitters',
        success: false,
        error: state.error || 'PTZ camera is not ready',
      };
    }

    return serializeVendorState(async () => {
      const lightPayload = { channel: 0, state: spotlightCameraStateForLogicalOn(false) };
      const irPayload = { channel: 0, state: normalizeIrState('off') };

      /*
        Publish the idle policy immediately, then read back the camera state
        after both writes. Failures remain visible to the idle service.
      */
      state.light = normalizeSpotlightState({
        ...(state.light || {}),
        ...lightPayload,
        on: false,
      });
      state.ir = {
        ...(state.ir || {}),
        ...irPayload,
      };
      emitChange('idle-emitters-off-pending');

      await callReolinkApi('SetWhiteLed', { WhiteLed: lightPayload });
      await callReolinkApi('SetIrLights', { IrLights: irPayload });

      /*
        Read back once after the writes so stale optimistic state does not linger
        forever. The existing spotlight button path delays verification because it
        is user-facing and frequently toggled; idle fires rarely, so one ordered
        refresh keeps the final state simple.
      */
      await refreshVendorState();

      emitChange('idle-emitters-off');
      return {
        action: 'disablePtzEmitters',
        success: true,
        failures: [],
      };
    });
  }

  function getSnapshotPath() {
    return path.join(SNAPSHOT_DIR, `${PTZ_STREAM_PATH}.jpg`);
  }

  async function pollSnapshot() {
    try {
      const filePath = getSnapshotPath();
      const stats = await fs.stat(filePath);
      if (lastSnapshotState?.mtimeMs && stats.mtimeMs <= lastSnapshotState.mtimeMs) return;
      const buffer = await fs.readFile(filePath);
      lastSnapshotState = { frame: buffer, ts: stats.mtimeMs || Date.now(), error: null, mtimeMs: stats.mtimeMs };
      if (retired) return;
      events.emit('snapshot:frame', { id: PTZ_CAMERA_ID, buffer, ts: lastSnapshotState.ts });
    } catch (err) {
      lastSnapshotState = {
        ...(lastSnapshotState || {}),
        error: err.code === 'ENOENT' ? 'Snapshot missing' : err.message,
      };
      if (retired) return;
      events.emit('snapshot:status', { id: PTZ_CAMERA_ID, error: lastSnapshotState.error });
    }
  }

  function startSnapshotPolling() {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(() => {
      pollSnapshot().catch((err) => logger.warn('snapshot poll failed', { error: err.message }));
    }, SNAPSHOT_POLL_MS);
  }

  function stop() {
    retired = true;
    enabled = false;
    stopPublisher();
    clearInterval(snapshotTimer);
    clearTimeout(spotlightVerifyTimer);
    clearTimeout(publisherStderrSyncTimer);
    audioPlayback.dispose();
    const stopped = forceMotionStop('configuration-change');
    return stopped.finally(() => { onvifCam = null; });
  }

  return {
    state, initialize, stop, queueMotionIntent, forceMotionStop,
    getStatus, listPresets, gotoPreset, createPreset, removePreset,
    setSpotlight, setIr, disableEmittersForIdle,
    getSnapshot: () => lastSnapshotState,
    getAudioState: () => audioPlayback.getState(),
    speakText: (text, options, context, authorize) => audioPlayback.speakText(text, options, context, authorize),
  };
}

module.exports = { createCameraRuntime };
