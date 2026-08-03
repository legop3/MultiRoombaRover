// Latency Harness WHIP Uplink Smoke Test
// Purpose: Measures browser-to-rover audio latency, the push-to-talk and VIP audio direction.
// Scope: One verbose run. Browser generation is page/whip-uplink-probe.js; detection is lib/forwardProbe.js.
const path = require('path');
const {
  startMediaMtx,
  srtReadUrl,
  rtspReadUrl,
  whipPublishUrl,
  waitForPathReady,
  acquireRunLock,
  killHarnessOrphans,
} = require('./lib/stack');
const { launchBrowser } = require('./lib/browserProbe');
const { startPageServer } = require('./lib/pageServer');
const { startForwardProbe, attributeOnsets, describeSpread } = require('./lib/forwardProbe');
const { installWhipUplinkProbe } = require('./page/whip-uplink-probe');
const { summarize, formatSummary, intervalsFrom } = require('./lib/stats');

const CONFIG = () => path.resolve(__dirname, '..', 'config', CONFIG_FILE);
const MEASURE_MS = Number(process.env.MEASURE_MS || 15_000);
/*
  3000ms rather than 1000ms. The grid interval bounds the unambiguous measurement range, and a
  1000ms grid aliased a real ~1016ms reading down to 16.7ms during development. loudnorm alone
  buffers roughly a second, so the window has to be comfortably wider than anything being
  measured.
*/
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 3000);
const BURST_MS = 40;
const FREQ_HZ = 1000;
// The rover applies this when audioPlayback.normalize is on. Off by default here so the
// baseline measures the transport; set NORMALIZE=1 to price the filter.
const NORMALIZE_FILTER = process.env.NORMALIZE === '1' ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : null;
/*
  How the ROVER reads the forwarded stream. Production uses SRT with m=request, which means
  MediaMTX muxes into MPEG-TS and the rover demuxes it - the same container that cost ~160ms
  on the download path. This makes that leg a measured variable rather than an assumption.
*/
const READ_TRANSPORT = process.env.READ_TRANSPORT || 'srt';
const CONFIG_FILE = READ_TRANSPORT === 'rtsp' ? 'mediamtx-rtsp-probe.yml' : 'mediamtx-baseline.yml';

async function main() {
  acquireRunLock();
  if (process.argv.includes('--clean')) {
    const killed = killHarnessOrphans({ onLog: (line) => console.error(line) });
    console.error(killed ? `cleaned ${killed} orphan(s)` : 'no harness orphans found');
  }

  const streamId = `smoke-whip-uplink-${READ_TRANSPORT}`;
  const mediamtxLog = [];
  let server = null;
  let pageServer = null;
  let browser = null;
  let forward = null;

  try {
    server = await startMediaMtx({ configPath: CONFIG(), onLog: (line) => mediamtxLog.push(line.trim()) });
    console.log('mediamtx: ready');

    pageServer = await startPageServer();
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[page]', err.message));
    await page.goto(`${pageServer.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(installWhipUplinkProbe);

    const anchor = await page.evaluate(
      (options) => window.__startWhipUplink(options),
      {
        whipUrl: whipPublishUrl({ streamId }),
        intervalMs: INTERVAL_MS,
        durationMs: BURST_MS,
        frequencyHz: FREQ_HZ,
        iceServers: [],
      },
    );
    console.log(`browser publishing via WHIP (sampleRate ${anchor.sampleRate}, ${INTERVAL_MS}ms grid)`);

    await waitForPathReady({ pathName: streamId });
    console.log('path: ready');

    /*
      Read the forwarded stream the way the rover does. The rover requests it over SRT with
      m=request, so the same URL shape is used here.
    */
    forward = startForwardProbe({
      readUrl: READ_TRANSPORT === 'rtsp'
        ? rtspReadUrl({ streamId })
        : srtReadUrl({ streamId }),
      normalizeFilter: NORMALIZE_FILTER,
      onStderr: (text) => {
        const line = text.trim().split('\n')[0];
        if (line) console.error('[forward]', line);
      },
    });
    console.log(`forward listener: started (replicating audio-forward-listener.sh, reading via ${READ_TRANSPORT})`);

    await new Promise((resolve) => setTimeout(resolve, MEASURE_MS));

    const stats = await page.evaluate(() => window.__collectWhipStats());
    const probe = await page.evaluate(() => ({
      events: window.__whipProbe.events,
      status: window.__whipProbe.status,
      startWallMs: window.__whipProbe.startWallMs,
    }));

    const attributed = attributeOnsets({
      onsets: forward.onsets,
      startWallMs: probe.startWallMs,
      intervalMs: INTERVAL_MS,
    });
    const usable = attributed.filter((onset) => !onset.ambiguous);
    const ambiguous = attributed.length - usable.length;

    console.log('');
    console.log('=== browser -> rover uplink latency (WHIP in, rover listener out) ===');
    /*
      Unlike the download measurement, no output-device buffer sits inside this number: the
      generated samples are encoded, never played locally. What is still outside it is ALSA's
      buffer in aplay and the speaker, so this is browser-to-rover-PCM and a lower bound on
      what a person in the room hears.
    */
    console.log('(browser-to-PCM: excludes aplay/ALSA output buffering on the rover)');
    console.log(formatSummary('onset latency', summarize(usable.map((onset) => onset.latencyMs))));
    console.log(formatSummary('onset interval', summarize(intervalsFrom(usable))));
    if (ambiguous) {
      console.log(`${ambiguous} onset(s) too close to a grid boundary, excluded as ambiguous.`);
    }
    const negatives = attributed.filter((onset) => onset.negative).length;
    if (negatives) {
      console.log(`WARNING: ${negatives} onset(s) came out negative. Latency cannot be negative;`);
      console.log('this means the grid interval is too short for the latency present, or the anchor is wrong.');
    }
    const spread = describeSpread(usable.map((onset) => onset.latencyMs), { intervalMs: INTERVAL_MS });
    if (spread?.suspiciousSpread) {
      console.log(`WARNING: latency spread is ${spread.range}ms, wide enough to suggest two clusters`);
      console.log('rather than one distribution. That is the signature of grid aliasing - widen INTERVAL_MS.');
    }
    console.log(`normalize filter: ${NORMALIZE_FILTER || 'off'}   rover read transport: ${READ_TRANSPORT}`);

    console.log('');
    console.log('=== sender detail ===');
    console.log(JSON.stringify({
      packetsSent: stats?.outbound?.packetsSent ?? null,
      bytesSent: stats?.outbound?.bytesSent ?? null,
      // Uplink is the rover's download, not the constrained server upload, but worth seeing.
      uplinkKbps: stats?.outbound?.bytesSent
        ? Math.round((stats.outbound.bytesSent * 8) / (MEASURE_MS / 1000) / 1000)
        : null,
      roundTripTimeMs: stats?.candidatePair?.currentRoundTripTime != null
        ? Math.round(stats.candidatePair.currentRoundTripTime * 1000 * 10) / 10
        : null,
    }, null, 2));
    console.log('forward:', JSON.stringify(forward.stats()));

    console.log('');
    probe.events.forEach((event) => console.log(`  ${event.event}${event.detail !== null ? ` ${event.detail}` : ''}`));

    if (!usable.length) {
      console.log('');
      console.log('No usable onsets. mediamtx tail:');
      console.log(mediamtxLog.slice(-20).join('\n'));
      process.exitCode = 1;
    }
  } finally {
    if (forward) forward.stop();
    if (browser) await browser.close().catch(() => {});
    if (pageServer) await pageServer.stop().catch(() => {});
    if (server) await server.stop().catch(() => {});
  }
}

main().catch((err) => {
  console.error('whip uplink smoke failed:', err.stack || err.message);
  process.exitCode = 1;
});
