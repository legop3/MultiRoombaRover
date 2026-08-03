// Latency Harness Audio Smoke Test
// Purpose: Measures rover-microphone-to-browser audio latency through the real Opus/SRT path.
// Scope: One verbose run. Detection is page/audio-probe.js; the marker grid is lib/audioSource.js.
const path = require('path');
const {
  startMediaMtx,
  srtPublishUrl,
  whipPublishUrl,
  rtspPublishUrl,
  whepUrl,
  waitForPathReady,
  acquireRunLock,
  killHarnessOrphans,
} = require('./lib/stack');
const { startAudioSource, MARKER_INTERVAL_MS } = require('./lib/audioSource');
const { launchBrowser, runBrowserAudioProbe } = require('./lib/browserProbe');
const { startPageServer } = require('./lib/pageServer');
const { summarize, formatSummary } = require('./lib/stats');

const CONFIG = () => path.resolve(__dirname, '..', 'config', CONFIG_FILE);
const MEASURE_MS = Number(process.env.MEASURE_MS || 15_000);
// mpegts/SRT mirrors the shipped audio publisher; whip is the candidate replacement.
const CONTAINER = process.env.CONTAINER || 'mpegts';
/*
  Opus frame duration is the audio equivalent of a GOP for latency: the encoder cannot emit
  anything until it has a whole frame. The shipped publisher uses 20ms; 10ms should halve
  that contribution, and Opus supports down to 2.5ms.
*/
const FRAME_DURATION_MS = Number(process.env.FRAME_DURATION_MS || 20);
// Set JITTER_TARGET=0 to ask the receiver for the smallest audio buffer it will accept.
const JITTER_TARGET = process.env.JITTER_TARGET === undefined ? null : Number(process.env.JITTER_TARGET);
const CONFIG_FILE = CONTAINER === 'rtsp' ? 'mediamtx-rtsp-probe.yml' : 'mediamtx-baseline.yml';

async function main() {
  acquireRunLock();
  if (process.argv.includes('--clean')) {
    const killed = killHarnessOrphans({ onLog: (line) => console.error(line) });
    console.error(killed ? `cleaned ${killed} orphan(s)` : 'no harness orphans found');
  }

  const epochMs = Date.now();
  const streamId = `smoke-audio-${CONTAINER}-${FRAME_DURATION_MS}`;
  const mediamtxLog = [];
  const publisherErrors = [];

  const server = await startMediaMtx({ configPath: CONFIG(), onLog: (line) => mediamtxLog.push(line.trim()) });
  console.log('mediamtx: ready');

  const source = startAudioSource({
    publishUrl: CONTAINER === 'whip'
      ? whipPublishUrl({ streamId })
      : CONTAINER === 'rtsp'
        ? rtspPublishUrl({ streamId })
        : srtPublishUrl({ streamId }),
    container: CONTAINER,
    frameDurationMs: FRAME_DURATION_MS,
    epochMs,
    onStderr: (text) => {
      String(text).split('\n').filter((line) => /error|fail|invalid/i.test(line)).forEach((line) => {
        publisherErrors.push(line);
      });
    },
  });
  console.log(`audio publisher: started (${CONTAINER}, opus ${FRAME_DURATION_MS}ms frames, ${MARKER_INTERVAL_MS}ms marker grid)`);

  try {
    await waitForPathReady({ pathName: streamId });
  } catch (err) {
    console.error(err.message);
    console.error('publisher stderr:', publisherErrors.join('\n') || '(none)');
    console.error('mediamtx tail:', mediamtxLog.slice(-15).join('\n'));
    source.stop();
    await server.stop();
    process.exitCode = 1;
    return;
  }
  console.log('path: ready');

  const pageServer = await startPageServer();
  const browser = await launchBrowser();

  const result = await runBrowserAudioProbe({
    browser,
    pageOrigin: pageServer.origin,
    whepUrl: whepUrl({ streamId }),
    epochMs,
    durationMs: MEASURE_MS,
    markerIntervalMs: MARKER_INTERVAL_MS,
    sourceStartOffsetMs: source.spec.startOffsetMs,
    playoutDelayHint: 0,
    jitterBufferTarget: JITTER_TARGET,
    onConsole: (text) => console.error('[page]', text),
  });

  source.stop();
  await browser.close();
  await pageServer.stop();
  await server.stop();

  /*
    Onsets flagged ambiguous are excluded from the summary. Past half the marker
    interval an onset could belong to the previous burst, so including it would report
    a confidently wrong number rather than an uncertain one.
  */
  const usable = result.onsets.filter((onset) => !onset.ambiguous);
  const ambiguous = result.onsets.length - usable.length;

  console.log('');
  console.log('=== rover mic -> browser audio latency ===');
  /*
    Absolute audio numbers here are less trustworthy than the video ones. A headless
    browser has no real output device, so AudioContext.outputLatency reflects an arbitrary
    software buffer rather than what a user's hardware would add, and that buffer is inside
    the number. Comparisons between runs of this same probe are sound - both sides pay the
    identical overhead - but do not quote the absolute figure as a user-facing latency.
  */
  console.log('(absolute value includes headless AudioContext output buffering; compare runs, not absolutes)');
  console.log(formatSummary('onset latency', summarize(usable.map((onset) => onset.latencyMs))));
  console.log(`context sample rate: ${result.contextSampleRate ?? '-'}`);
  if (ambiguous) {
    console.log(`${ambiguous} onset(s) exceeded half the ${MARKER_INTERVAL_MS}ms grid and were excluded as ambiguous.`);
    console.log('If most samples are ambiguous the grid is too tight for the latency present; widen it.');
  }

  const jitterBuffer = result.stats?.jitterBufferEmittedCount
    ? Math.round((result.stats.jitterBufferDelay / result.stats.jitterBufferEmittedCount) * 1000 * 10) / 10
    : null;
  console.log('');
  console.log('=== receiver detail ===');
  console.log(JSON.stringify({
    meanJitterBufferMs: jitterBuffer,
    /*
      jitterBufferTargetDelay is a cumulative seconds counter like jitterBufferDelay, not
      an instantaneous target. Reporting it raw printed a meaningless 78316ms, so it is
      divided by the same emitted count.
    */
    meanTargetJitterBufferMs: result.stats?.jitterBufferEmittedCount
      ? Math.round((result.stats.jitterBufferTargetDelay / result.stats.jitterBufferEmittedCount) * 1000 * 10) / 10
      : null,
    packetsReceived: result.stats?.packetsReceived ?? null,
    packetsLost: result.stats?.packetsLost ?? null,
    // Concealment is the audio equivalent of a freeze: samples invented to cover a gap.
    concealedSamples: result.stats?.concealedSamples ?? null,
    totalSamplesReceived: result.stats?.totalSamplesReceived ?? null,
  }, null, 2));

  console.log('');
  result.events.forEach((event) => {
    console.log(`  +${event.at - epochMs}ms ${event.event}${event.detail !== null ? ` ${event.detail}` : ''}`);
  });

  if (!usable.length) {
    console.log('');
    console.log('No usable onsets. mediamtx tail:');
    console.log(mediamtxLog.slice(-20).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('audio smoke failed:', err.stack || err.message);
  process.exitCode = 1;
});
