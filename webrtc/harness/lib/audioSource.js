// Latency Harness Audio Source
// Purpose: Publishes an audio stream whose waveform encodes when each marker was emitted.
// Scope: Mirrors pi/bin/audio-only-publisher.sh encoder settings; detection lives in the browser probe.
const { spawn } = require('child_process');

/*
  Audio cannot carry a pixel timecode, so the timing reference is the waveform
  itself: a short tone burst emitted exactly on a known grid, with silence between.
  The browser notes when it hears each onset and subtracts the grid time.

  The grid interval sets the unambiguous measurement range. A burst every 1000ms
  can be attributed correctly as long as latency stays under 500ms; beyond that the
  probe could credit an onset to the wrong burst. 1000ms is chosen because the
  numbers being chased here are well inside that, and a wider grid would collect
  samples too slowly to see jitter.
*/
const MARKER_INTERVAL_MS = 1000;
const MARKER_DURATION_MS = 40;
const MARKER_FREQ_HZ = 1000;

/*
  Matches audio-only-publisher.sh: libopus at 48k stereo, 20ms frames,
  compression_level 0, application audio, and the same mpegts low-latency muxing.
  frame_duration is the audio equivalent of a GOP for latency purposes, so it has to
  be reproduced exactly for the measurement to mean anything.
*/
function buildAudioFfmpegArgs({ sampleRate, channels, bitrate, publishUrl, frameDurationMs, container = 'mpegts', application = 'audio' }) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', 'nobuffer',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-use_wallclock_as_timestamps', '1',
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', String(bitrate),
    '-ar:a', String(sampleRate),
    '-ac:a', String(channels),
    '-application', application,
    '-frame_duration', String(frameDurationMs),
    '-compression_level', '0',
    '-flush_packets', '1',
    '-muxdelay', '0',
    '-muxpreload', '0',
    /*
      Same container question as video. The shipped publisher uses mpegts over SRT;
      WHIP is the candidate replacement, and since Opus is already WebRTC's native
      audio codec it needs no transcode on the way through.
    */
    ...(container === 'whip'
      ? ['-f', 'whip', '-pkt_size', '1200']
      : container === 'rtsp'
        ? ['-f', 'rtsp', '-rtsp_transport', 'udp']
        : ['-f', 'mpegts']),
    publishUrl,
  ];
}

function startAudioSource({
  ffmpegBin = 'ffmpeg',
  sampleRate = 48_000,
  channels = 2,
  bitrate = 128_000,
  frameDurationMs = 20,
  container = 'mpegts',
  // 'audio' matches the rover microphone publisher; 'lowdelay' matches the server's
  // forward publisher in audioForwardService/workerEngine.js.
  application = 'audio',
  publishUrl,
  epochMs,
  onStderr,
  onExit,
}) {
  if (!publishUrl) throw new Error('publishUrl required');
  const proc = spawn(
    ffmpegBin,
    buildAudioFfmpegArgs({ sampleRate, channels, bitrate, publishUrl, frameDurationMs, container, application }),
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );

  proc.stderr.on('data', (chunk) => onStderr?.(chunk.toString()));
  /*
    A dead encoder makes the next stdin write raise an 'error' event, and an unhandled one takes
    the whole process down with EPIPE. That is exactly what happens when a publish is rejected:
    ffmpeg exits, the frame pump writes into the closed pipe, and the harness crashes reporting a
    node stack trace instead of the server's actual rejection reason.
  */
  proc.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') onStderr?.(`stdin error: ${err.message}\n`);
  });

  // Written in 20ms chunks so a burst boundary is never delayed by a large
  // pending write sitting in the pipe ahead of it.
  const chunkMs = 20;
  const samplesPerChunk = Math.round((sampleRate * chunkMs) / 1000);
  const bytesPerSample = 2 * channels;
  const chunk = Buffer.alloc(samplesPerChunk * bytesPerSample);

  let stopped = false;
  let timer = null;
  let sampleCursor = 0;
  const markerTimes = [];
  const startedAt = Date.now();

  function fillChunk() {
    chunk.fill(0);
    for (let index = 0; index < samplesPerChunk; index += 1) {
      const absoluteSample = sampleCursor + index;
      const positionMs = (absoluteSample / sampleRate) * 1000;
      const withinGrid = positionMs % MARKER_INTERVAL_MS;
      if (withinGrid < MARKER_DURATION_MS) {
        /*
          A raised-cosine envelope instead of a hard gate. A square-edged burst
          spreads energy across the spectrum and Opus spends its bitrate smearing
          that transient, which moves the onset the probe is trying to time.
        */
        const envelopePosition = withinGrid / MARKER_DURATION_MS;
        const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * envelopePosition));
        const value = Math.round(
          envelope * 0.8 * 32767 * Math.sin(2 * Math.PI * MARKER_FREQ_HZ * (absoluteSample / sampleRate)),
        );
        for (let channel = 0; channel < channels; channel += 1) {
          chunk.writeInt16LE(value, (index * channels + channel) * 2);
        }
      }
    }
    sampleCursor += samplesPerChunk;
  }

  function pump() {
    if (stopped) return;

    /*
      Marker times are recorded from the audio sample cursor, not from wall clock at
      write time. The sample cursor is what the listener actually hears, so deriving
      the reference from it keeps the measurement immune to write jitter in node.
    */
    const chunkStartMs = (sampleCursor / sampleRate) * 1000;
    const chunkEndMs = chunkStartMs + chunkMs;
    for (
      let gridMs = Math.ceil(chunkStartMs / MARKER_INTERVAL_MS) * MARKER_INTERVAL_MS;
      gridMs < chunkEndMs;
      gridMs += MARKER_INTERVAL_MS
    ) {
      markerTimes.push({ gridMs, emittedAtMs: startedAt - epochMs + gridMs });
    }

    fillChunk();
    const ok = proc.stdin.write(chunk);

    const nextAt = startedAt + (sampleCursor / sampleRate) * 1000;
    const delay = Math.max(0, nextAt - Date.now());
    if (!ok) {
      proc.stdin.once('drain', () => {
        timer = setTimeout(pump, delay);
      });
      return;
    }
    timer = setTimeout(pump, delay);
  }

  proc.on('exit', (code, signal) => {
    stopped = true;
    if (timer) clearTimeout(timer);
    onExit?.(code, signal);
  });

  pump();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        proc.stdin.end();
      } catch {
        // Already gone.
      }
      proc.kill('SIGTERM');
    },
    markerTimes,
    spec: {
      MARKER_INTERVAL_MS,
      MARKER_DURATION_MS,
      MARKER_FREQ_HZ,
      startOffsetMs: startedAt - epochMs,
    },
    process: proc,
  };
}

module.exports = {
  startAudioSource,
  buildAudioFfmpegArgs,
  MARKER_INTERVAL_MS,
  MARKER_DURATION_MS,
  MARKER_FREQ_HZ,
};
