// Latency Harness WHEP Smoke Test
// Purpose: Proves the browser probe measures real glass-to-glass latency through the full WHEP path.
// Scope: One run, verbose output. The repeatable form is measure.js.
const path = require('path');
const { startMediaMtx, srtPublishUrl, srtReadUrl, whepUrl } = require('./lib/stack');
const { startVideoSource } = require('./lib/videoSource');
const { launchBrowser, runBrowserVideoProbe, deriveQuality } = require('./lib/browserProbe');
const { startPageServer } = require('./lib/pageServer');
const { summarize, intervalsFrom, formatSummary } = require('./lib/stats');

const CONFIG = path.resolve(__dirname, '..', 'config', 'mediamtx-baseline.yml');
const STREAM_ID = 'smoke-whep';
const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30;
const GOP = Number(process.env.GOP || 120);
const MEASURE_MS = Number(process.env.MEASURE_MS || 15_000);

async function main() {
  const epochMs = Date.now();
  const mediamtxLog = [];
  const server = await startMediaMtx({ configPath: CONFIG, onLog: (l) => mediamtxLog.push(l.trim()) });
  console.log('mediamtx: ready');

  const source = startVideoSource({
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    bitrate: 2_000_000,
    gop: GOP,
    publishUrl: srtPublishUrl({ streamId: STREAM_ID }),
    epochMs,
    onStderr: (t) => {
      const line = t.trim().split('\n')[0];
      if (line) console.error('[publisher]', line);
    },
  });
  console.log(`publisher: started (gop=${GOP})`);

  await new Promise((r) => setTimeout(r, 1500));


  const pageServer = await startPageServer();
  const browser = await launchBrowser();
  console.log(`chromium: launched (page origin ${pageServer.origin})`);

  const result = await runBrowserVideoProbe({
    browser,
    pageOrigin: pageServer.origin,
    whepUrl: whepUrl({ streamId: STREAM_ID }),
    epochMs,
    width: WIDTH,
    height: HEIGHT,
    durationMs: MEASURE_MS,
    iceServers: [],
    playoutDelayHint: 0,
    onConsole: (text) => console.error('[page]', text),
  });

  source.stop();
  await browser.close();
  await pageServer.stop();
  await server.stop();

  const browserLatency = summarize(result.samples.map((s) => s.latencyMs));
  const presented = summarize(result.samples.map((s) => s.presentedLatencyMs));
  const browserIntervals = summarize(intervalsFrom(result.samples));
  const quality = deriveQuality(result.stats);

  console.log('');
  console.log('=== latency ===');
  console.log(formatSummary('browser (js receipt)', browserLatency));
  console.log(formatSummary('browser (presented)', presented));
  console.log(formatSummary('browser frame interval', browserIntervals));
  console.log('');
  console.log('=== attach ===');
  console.log('whep connect -> first decoded frame:', result.connectMs !== null ? `${result.connectMs}ms` : 'never');
  console.log('');
  console.log('=== quality (must not regress while chasing latency) ===');
  console.log(JSON.stringify(quality, null, 2));
  console.log('');
  console.log('=== page events ===');
  result.events.forEach((e) => console.log(`  +${e.at - epochMs}ms ${e.event}${e.detail !== null ? ` ${e.detail}` : ''}`));
  console.log('');
  console.log('source:', JSON.stringify(source.stats()));

  if (!result.samples.length) {
    console.log('');
    console.log('--- mediamtx log tail ---');
    console.log(mediamtxLog.slice(-20).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('smoke failed:', err.stack || err.message);
  process.exitCode = 1;
});
