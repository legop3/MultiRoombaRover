// Latency Harness Browser Driver
// Purpose: Launches headless Chromium, installs the page probe, and collects its samples.
// Scope: Owns browser flags and lifecycle; the decode logic lives in page/whep-probe.js.
const path = require('path');
const { timecodeSpec } = require('./timecode');
const { installWhepProbe } = require('../page/whep-probe');
const { installAudioProbe } = require('../page/audio-probe');

const BROWSERS_PATH = path.resolve(__dirname, '..', '..', 'vendor', 'browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || BROWSERS_PATH;

/*
  Chromium normally protects a real user from a stream that arrives faster than the
  display can show it, and normally that is correct. For measurement it is not: the
  defaults would add smoothing on top of whatever the pipeline does and the result
  would describe Chromium's policy rather than the pipeline's behavior.

  These flags remove that smoothing so the number attributes to the code under test.
  They are a measurement instrument, not a recommendation for production.
*/
const CHROMIUM_ARGS = [
  // Without a fake device Chromium refuses getUserMedia, which the WHIP probe needs.
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  // Headless has no real vsync. Letting the compositor free-run stops frame
  // presentation being quantized to an artificial refresh interval.
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  // Background throttling would stall the probe loop whenever the page is not
  // considered visible, which in headless is most of the time.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required',
];

/*
  Bounds any step that can block on the network.

  page.evaluate awaiting a WHEP fetch has no timeout of its own, so a request that neither
  answers nor errors hangs the whole run. That happened against a remote server: the trial sat for
  minutes and was eventually killed by the outer timeout, printing nothing at all, which is
  strictly worse than a failure - a failure names the scenario and lets the sweep continue.
*/
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not complete within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function launchBrowser({ headless = true } = {}) {
  const { chromium } = require('playwright');
  const browser = await withTimeout(chromium.launch({ headless, args: CHROMIUM_ARGS }), 60_000, 'browser launch');
  return browser;
}

async function runBrowserVideoProbe({
  browser,
  pageOrigin,
  whepUrl,
  epochMs,
  width,
  height,
  durationMs,
  iceServers = [],
  playoutDelayHint = 0,
  jitterBufferTarget = null,
  onConsole,
}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (onConsole) {
    page.on('console', (message) => onConsole(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (err) => onConsole(`pageerror: ${err.message}`));
  }

  /*
    Navigating to a served page rather than using setContent. setContent leaves the
    document on an opaque origin, which sends `Origin: null` on the WHEP preflight
    and Chromium rejects the response regardless of the wildcard CORS header
    MediaMTX returns.
  */
  await page.goto(`${pageOrigin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(installWhepProbe);

  const startedAt = Date.now();
  await withTimeout(
    page.evaluate(
      (options) => window.__startProbe(options),
      { whepUrl, epochMs, spec: timecodeSpec(), iceServers, playoutDelayHint, jitterBufferTarget, width, height },
    ),
    30_000,
    'WHEP setup',
  );

  /*
    Bandwidth has to be a steady-state rate, not an average since connection start.
    bytesReceived accumulates from the first packet, so it is sampled at both ends of
    the measurement window and differenced. Without this the figure would be diluted
    by setup and by the keyframe burst, and understate what a viewer actually costs.
  */
  const openingStats = await page.evaluate(() => window.__collectStats());
  const openingAt = Date.now();

  await page.waitForTimeout(durationMs);

  const stats = await page.evaluate(() => window.__collectStats());
  const closingAt = Date.now();
  const probe = await page.evaluate(() => ({
    samples: window.__probe.samples,
    events: window.__probe.events,
    status: window.__probe.status,
    connectStartedAt: window.__probe.connectStartedAt,
    firstFrameAt: window.__probe.firstFrameAt,
  }));

  /*
    Release before closing the context, not after: once the context is gone there is no page
    left to send from. Skipping this leaves MediaMTX serving a departed viewer for ~31s, which
    silently inflates the next measurement's viewer count and server egress.

    Awaited so the DELETE has actually been issued before teardown, and swallowed because a
    failed release degrades to the server's own timeout rather than failing the measurement.
  */
  const released = await page.evaluate(() => window.__releaseWhepSession()).catch(() => null);

  await context.close();

  return {
    ...probe,
    stats,
    bandwidth: measureBandwidth(openingStats, stats, closingAt - openingAt),
    connectMs: probe.firstFrameAt ? probe.firstFrameAt - probe.connectStartedAt : null,
    sessionReleased: released,
    wallMs: Date.now() - startedAt,
  };
}

/*
  Drives the audio onset probe. Kept separate from the video probe rather than merged:
  the two measure different things by different means, and a combined page would make a
  failure in one look like a fault in the other.
*/
async function runBrowserAudioProbe({
  browser,
  pageOrigin,
  whepUrl,
  epochMs,
  durationMs,
  markerIntervalMs,
  sourceStartOffsetMs,
  iceServers = [],
  playoutDelayHint = 0,
  jitterBufferTarget = null,
  onConsole,
}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (onConsole) {
    page.on('console', (message) => onConsole(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (err) => onConsole(`pageerror: ${err.message}`));
  }

  await page.goto(`${pageOrigin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(installAudioProbe);
  await withTimeout(
    page.evaluate(
      (options) => window.__startAudioProbe(options),
      { whepUrl, epochMs, markerIntervalMs, sourceStartOffsetMs, iceServers, playoutDelayHint, jitterBufferTarget },
    ),
    30_000,
    'audio WHEP setup',
  );

  await page.waitForTimeout(durationMs);

  const stats = await page.evaluate(() => window.__collectAudioStats());
  const probe = await page.evaluate(() => ({
    onsets: window.__audioProbe.onsets,
    events: window.__audioProbe.events,
    status: window.__audioProbe.status,
    contextSampleRate: window.__audioProbe.contextSampleRate,
  }));
  await context.close();
  return { ...probe, stats };
}

/*
  Steady-state egress cost per viewer. This is the figure the production server's
  upload budget is spent on: every WHEP viewer pays it in full, so it is reported
  alongside latency and quality rather than left to be inferred from the configured
  bitrate. The configured bitrate is a ceiling the encoder need not reach, so only a
  measurement says what a viewer really costs.
*/
function measureBandwidth(opening, closing, elapsedMs) {
  const seconds = elapsedMs / 1000;
  if (!(seconds > 0)) return null;
  const rate = (before, after) => {
    if (before?.bytesReceived == null || after?.bytesReceived == null) return null;
    const delta = after.bytesReceived - before.bytesReceived;
    if (!(delta >= 0)) return null;
    return Math.round((delta * 8) / seconds / 1000);
  };
  const videoKbps = rate(opening?.inboundVideo, closing?.inboundVideo);
  const audioKbps = rate(opening?.inboundAudio, closing?.inboundAudio);
  return {
    videoKbps,
    audioKbps,
    totalKbps: videoKbps != null ? videoKbps + (audioKbps || 0) : null,
    windowMs: elapsedMs,
  };
}

/*
  Derived quality figures. qpSum divided by framesDecoded is the average quantizer
  the encoder settled on, and it is the number to watch when trading latency for
  bitrate: rising QP is the same thing as the picture going blocky. Reporting it
  next to latency is what stops a "win" that is really just a worse picture.
*/
function deriveQuality(stats) {
  const video = stats?.inboundVideo;
  if (!video) return null;
  const framesDecoded = video.framesDecoded || 0;
  const emitted = video.jitterBufferEmittedCount || 0;
  return {
    framesDecoded,
    framesDropped: video.framesDropped ?? null,
    framesPerSecond: video.framesPerSecond ?? null,
    resolution: video.frameWidth ? `${video.frameWidth}x${video.frameHeight}` : null,
    averageQp: framesDecoded && video.qpSum != null
      ? Math.round((video.qpSum / framesDecoded) * 10) / 10
      : null,
    freezeCount: video.freezeCount ?? null,
    totalFreezesDurationMs: video.totalFreezesDuration != null
      ? Math.round(video.totalFreezesDuration * 1000)
      : null,
    // jitterBufferDelay is cumulative seconds across emitted frames, so the mean
    // per-frame buffer wait is the ratio. This is usually the single largest
    // controllable contributor to WebRTC latency.
    meanJitterBufferMs: emitted
      ? Math.round((video.jitterBufferDelay / emitted) * 1000 * 10) / 10
      : null,
    meanDecodeMs: framesDecoded && video.totalDecodeTime != null
      ? Math.round((video.totalDecodeTime / framesDecoded) * 1000 * 10) / 10
      : null,
    meanAssemblyMs: framesDecoded && video.totalAssemblyTime != null
      ? Math.round((video.totalAssemblyTime / framesDecoded) * 1000 * 10) / 10
      : null,
    meanProcessingDelayMs: framesDecoded && video.totalProcessingDelay != null
      ? Math.round((video.totalProcessingDelay / framesDecoded) * 1000 * 10) / 10
      : null,
    packetsLost: video.packetsLost ?? null,
    packetsReceived: video.packetsReceived ?? null,
    kbps: null,
  };
}

module.exports = { launchBrowser, runBrowserVideoProbe, runBrowserAudioProbe, deriveQuality, measureBandwidth, withTimeout, CHROMIUM_ARGS };
