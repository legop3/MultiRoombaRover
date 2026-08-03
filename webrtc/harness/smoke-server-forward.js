// Latency Harness Server-Forward Smoke Test
// Purpose: Measures the server-originated audio path: server publish -> MediaMTX -> rover read.
// Scope: No browser involved. Covers the bonk sound, VIP clip playback, and forwarded TTS.
const path = require('path');
const {
  startMediaMtx,
  srtPublishUrl,
  srtReadUrl,
  rtspPublishUrl,
  rtspReadUrl,
  waitForPathReady,
  acquireRunLock,
  killHarnessOrphans,
} = require('./lib/stack');
const { startAudioSource, MARKER_INTERVAL_MS } = require('./lib/audioSource');
const { startForwardProbe, attributeOnsets, describeSpread } = require('./lib/forwardProbe');
const { summarize, formatSummary } = require('./lib/stats');

/*
  This is the one audio path with MPEG-TS on *both* legs. The server encodes and publishes to
  MediaMTX, and the rover reads back out, and today both are MPEG-TS - so server-originated
  audio pays the container cost twice where the browser microphone pays it once.

  Both legs are variables here so the two costs can be separated rather than assumed equal.

  No browser: the publisher is ffmpeg on the server and the consumer is ffmpeg on the rover, so
  a browser would only add unrelated overhead. That also makes this the fastest of the audio
  measurements to run.
*/

// Mirrors buildPublisherArgs in audioForwardService/workerEngine.js. Note the server is
// already latency-tuned - lowdelay application, 10ms frames - so the container is the only
// thing left to question.
const SERVER_PUBLISH = {
  sampleRate: 16_000,
  channels: 1,
  bitrate: 24_000,
  frameDurationMs: 10,
  application: 'lowdelay',
};

const PUBLISH_TRANSPORT = process.env.PUBLISH_TRANSPORT || 'mpegts';
const READ_TRANSPORT = process.env.READ_TRANSPORT || 'srt';
const MEASURE_MS = Number(process.env.MEASURE_MS || 24_000);
/*
  The burst grid comes from lib/audioSource.js, which owns burst generation here, so it is that
  constant rather than a local one. Stated explicitly because an earlier version accepted an
  INTERVAL_MS override that was never actually applied to attribution - a setting that silently
  does nothing is worse than no setting.
*/
const INTERVAL_MS = MARKER_INTERVAL_MS;

const NEEDS_RTSP = PUBLISH_TRANSPORT === 'rtsp' || READ_TRANSPORT === 'rtsp';
const CONFIG = path.resolve(
  __dirname, '..', 'config',
  NEEDS_RTSP ? 'mediamtx-rtsp-probe.yml' : 'mediamtx-baseline.yml',
);

async function main() {
  acquireRunLock();
  if (process.argv.includes('--clean')) {
    const killed = killHarnessOrphans({ onLog: (line) => console.error(line) });
    console.error(killed ? `cleaned ${killed} orphan(s)` : 'no harness orphans found');
  }

  const epochMs = Date.now();
  const streamId = `smoke-fwd-${PUBLISH_TRANSPORT}-${READ_TRANSPORT}`;
  const mediamtxLog = [];
  let server = null;
  let source = null;
  let forward = null;

  try {
    server = await startMediaMtx({ configPath: CONFIG, onLog: (line) => mediamtxLog.push(line.trim()) });

    source = startAudioSource({
      ...SERVER_PUBLISH,
      container: PUBLISH_TRANSPORT,
      publishUrl: PUBLISH_TRANSPORT === 'rtsp'
        ? rtspPublishUrl({ streamId })
        : srtPublishUrl({ streamId }),
      epochMs,
      onStderr: () => {},
    });
    console.log(`server publisher: ${PUBLISH_TRANSPORT} (opus ${SERVER_PUBLISH.bitrate}bps, ${SERVER_PUBLISH.frameDurationMs}ms frames, lowdelay)`);

    await waitForPathReady({ pathName: streamId });

    forward = startForwardProbe({
      readUrl: READ_TRANSPORT === 'rtsp' ? rtspReadUrl({ streamId }) : srtReadUrl({ streamId }),
      onStderr: () => {},
    });
    console.log(`rover reader:     ${READ_TRANSPORT}`);

    await new Promise((resolve) => setTimeout(resolve, MEASURE_MS));

    /*
      The audio source records marker times against its own start offset, so the reference for
      attribution is that offset rather than a browser anchor.
    */
    const attributed = attributeOnsets({
      onsets: forward.onsets,
      startWallMs: epochMs + source.spec.startOffsetMs,
      intervalMs: INTERVAL_MS,
    });
    const usable = attributed.filter((onset) => !onset.ambiguous);

    console.log('');
    console.log(`=== server audio -> rover PCM (publish ${PUBLISH_TRANSPORT}, read ${READ_TRANSPORT}) ===`);
    console.log(formatSummary('onset latency', summarize(usable.map((onset) => onset.latencyMs))));
    const negatives = attributed.filter((onset) => onset.negative).length;
    if (negatives) {
      console.log(`WARNING: ${negatives} negative reading(s) - grid too short or anchor wrong.`);
    }
    const spread = describeSpread(usable.map((onset) => onset.latencyMs), { intervalMs: INTERVAL_MS });
    if (spread?.suspiciousSpread) {
      console.log(`WARNING: spread ${spread.range}ms suggests two clusters, i.e. grid aliasing.`);
    }
    console.log('forward:', JSON.stringify(forward.stats()));

    if (!usable.length) {
      console.log('No usable onsets. mediamtx tail:');
      console.log(mediamtxLog.slice(-15).join('\n'));
      process.exitCode = 1;
    }
  } finally {
    if (source) source.stop();
    if (forward) forward.stop();
    if (server) await server.stop().catch(() => {});
  }
}

main().catch((err) => {
  console.error('server-forward smoke failed:', err.stack || err.message);
  process.exitCode = 1;
});
