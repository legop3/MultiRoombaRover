// Latency Harness Runner
// Purpose: Runs one or many pipeline configurations and reports latency next to quality so a change can be judged.
// Scope: Orchestration and reporting. Measurement lives in lib/*Probe.js.
const fs = require('fs');
const path = require('path');
const { startMediaMtx, srtPublishUrl, rtspPublishUrl, whipPublishUrl, whepUrl, waitForPathReady, killHarnessOrphans, acquireRunLock } = require('./lib/stack');
const { startVideoSource, startEncoderSink } = require('./lib/videoSource');
const { startCameraSource, waitForDeviceFree } = require('./lib/cameraSource');
const { launchBrowser, runBrowserVideoProbe, deriveQuality } = require('./lib/browserProbe');
const { startPageServer } = require('./lib/pageServer');
const { summarize, intervalsFrom, formatSummary } = require('./lib/stats');

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const RESULTS_DIR = path.resolve(__dirname, '..', 'results');

/*
  Every scenario changes as few things as possible relative to `baseline`, because a
  scenario that moves several knobs at once can show an improvement without telling
  you which knob earned it.

  The measured baseline put ~155ms of a 174ms total upstream of the browser, so the
  variants here interrogate the publish and ingest side. vbv-tight is the leading
  suspect: at 2Mbps a 1Mbit VBV buffer is 500ms of rate-control slack, and the
  encoder is free to use it to smooth bitrate at the cost of delay.
*/
const SCENARIOS = {
  baseline: {
    label: 'baseline (as shipped)',
    description: 'Reproduces the current rover pipeline settings exactly.',
  },
  'gop-30': {
    label: 'gop 30 (1s keyframes)',
    description: 'Shortens the 4s GOP. Expected to cut attach time; should not move steady-state latency.',
    gop: 30,
  },
  'gop-15': {
    label: 'gop 15 (0.5s keyframes)',
    description: 'Shorter still. Costs bitrate, so watch averageQp for the quality price.',
    gop: 15,
  },
  'vbv-tight': {
    label: 'vbv one frame',
    description: 'Shrinks the rate-control buffer to a single frame so the encoder cannot trade delay for smoothness.',
    bufsizeFrames: 1,
  },
  'vbv-none': {
    label: 'no vbv cap',
    description: 'Drops maxrate/bufsize entirely, leaving average bitrate only.',
    noVbv: true,
  },
  'srt-0': {
    label: 'srt latency 0',
    description: 'Removes the configured 10ms SRT buffer on each hop.',
    srtLatency: 0,
  },
  'rtsp-ingest': {
    label: 'rtsp ingest (no mpegts/srt)',
    description: 'Same encoded frames, published over RTSP. Isolates the mpegts mux and SRT transport from MediaMTX itself.',
    container: 'rtsp',
    mediamtxConfig: 'mediamtx-rtsp-probe.yml',
  },
  'rtsp-udp': {
    label: 'rtsp ingest over udp',
    description: 'Kept as a control, NOT a candidate: this fails outright over a real internet path.',
    container: 'rtsp',
    rtspTransport: 'udp',
    mediamtxConfig: 'mediamtx-rtsp-probe.yml',
  },
  'rtsp-udp-gop30': {
    label: 'rtsp udp + gop 30',
    description: 'Both wins together: UDP RTP ingest for steady-state latency, 1s keyframes for attach time.',
    container: 'rtsp',
    rtspTransport: 'udp',
    gop: 30,
    mediamtxConfig: 'mediamtx-rtsp-probe.yml',
  },
  /*
    WHIP ingest. Publishes RTP over ICE/DTLS, the same shape browsers already receive,
    so MediaMTX has no container to demux - which is where the measured 160ms lives.
    Unlike plain RTSP/UDP this is UDP *with* NACK/RTX, so it has retransmission where bare
    RTP/UDP has none - that distinction is the whole reason RTSP/UDP fails over the internet
    and WHIP does not. Also puts the rover on one protocol with the viewers.
  */
  whip: {
    label: 'whip ingest',
    description: 'Rover publishes WebRTC directly. No mpegts, no RTSP, UDP throughout.',
    container: 'whip',
  },
  'whip-gop30': {
    label: 'whip + gop 30',
    description: 'WHIP ingest with 1s keyframes, addressing latency and attach together.',
    container: 'whip',
    gop: 30,
  },
  /*
    Bitrate ladder. Production runs 2Mbps for 640x480 from an OV5647 and measured
    qp 1.2, which is near-lossless and roughly 3x more upload than this resolution
    needs. Since every WHEP viewer costs the full stream, this is the largest lever
    on the server's upload budget. These find the knee where qp starts indicating
    real degradation rather than guessing at a number.
  */
  'br-1200k': { label: '1.2 Mbps', description: 'Modest reduction from 2Mbps.', bitrate: 1_200_000, container: 'whip', gop: 30 },
  'br-800k': { label: '800 kbps', description: 'Conventional good-quality target for 640x480@30.', bitrate: 800_000, container: 'whip', gop: 30 },
  'br-600k': { label: '600 kbps', description: 'Lean but expected to hold up on a denoised OV5647 feed.', bitrate: 600_000, container: 'whip', gop: 30 },
  'br-400k': { label: '400 kbps', description: 'Deliberately past the knee, to establish where quality actually breaks.', bitrate: 400_000, container: 'whip', gop: 30 },
  /*
    Camera-fed variant. The bitrate decision has to come from a real sensor, not the
    synthetic source: noise is high-entropy and costs real bits, so a knee chosen on smooth
    gradients would under-provision the rovers and ship a blocky picture.

    The device comes from CAMERA_DEVICE rather than being hardcoded, so this is usable on any
    machine with a capture device instead of only the one it was written on. Combine with
    --bitrate-style scenarios by setting CAMERA_BITRATE.

      CAMERA_DEVICE=/dev/video0 CAMERA_BITRATE=800000 node measure.js camera
  */
  camera: {
    label: 'real camera at CAMERA_BITRATE',
    description: 'Real sensor content through WHIP. Requires CAMERA_DEVICE.',
    container: 'whip',
    gop: 30,
    bitrate: Number(process.env.CAMERA_BITRATE || 2_000_000),
    cameraDevice: process.env.CAMERA_DEVICE || null,
    cameraInputFormat: process.env.CAMERA_INPUT_FORMAT || 'mjpeg',
  },
  /*
    The container fix leaves ~8ms of receiver jitter buffer as the largest remaining
    controllable item. jitterBufferTarget is the standardised successor to
    playoutDelayHint and is the knob current Chromium actually honours, so these test
    whether the last few milliseconds can be reclaimed - and whether doing so costs
    concealment or freezes on a real network later.
  */
  'jbuf-0': {
    label: 'jitterBufferTarget 0',
    description: 'Ask for the smallest possible receiver buffer, on top of the container fix.',
    container: 'whip',
    jitterBufferTarget: 0,
  },
  'no-wallclock': {
    label: 'without -use_wallclock_as_timestamps',
    description: 'Tests whether stamping input timestamps from the wall clock costs a frame of buffering.',
    container: 'whip',
    wallclockTimestamps: false,
  },
  'fps-60': {
    label: '60fps',
    description: 'Halves the frame-interval quantisation a frame waits before encode. Doubles frame rate, so watch egress.',
    container: 'whip',
    fps: 60,
  },
  'mpegts-direct': {
    label: 'mpegts + low-latency mux flags',
    description: 'Keeps mpegts over SRT but removes ffmpeg muxer interleave and IO batching. Discriminates ffmpeg mux delay from MediaMTX demux delay.',
    lowLatencyMux: true,
  },
  'playout-default': {
    label: 'playoutDelayHint unset',
    description: 'Control for the existing playoutDelayHint=0. Shows what that setting is actually buying.',
    playoutDelayHint: null,
  },
  'placeholder-turn': {
    label: 'with placeholder TURN',
    description: 'Reproduces the unreachable TURN entry shipped in whepPlayer.js to price its cost.',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' },
    ],
  },
};

const DEFAULTS = {
  width: 640,
  height: 480,
  fps: 30,
  bitrate: 2_000_000,
  gop: 120,
  srtLatency: 10,
  playoutDelayHint: 0,
  jitterBufferTarget: null,
  iceServers: [],
  mediamtxConfig: 'mediamtx-baseline.yml',
  bufsizeFrames: null,
  noVbv: false,
  container: 'mpegts',
  lowLatencyMux: false,
  rtspTransport: 'tcp',
  wallclockTimestamps: true,
  cameraDevice: null,
  cameraInputFormat: 'mjpeg',
};

function resolveScenario(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  return { name, ...DEFAULTS, ...scenario };
}

function buildExtraOutputArgs(scenario) {
  // Rate-control shape is expressed here rather than inside videoSource so a
  // scenario can override it without the source module knowing about scenarios.
  if (scenario.noVbv) return { replaceVbv: [] };
  if (scenario.bufsizeFrames) {
    const perFrameBits = Math.floor(scenario.bitrate / scenario.fps) * scenario.bufsizeFrames;
    return { replaceVbv: ['-maxrate', String(scenario.bitrate), '-bufsize', String(perFrameBits)] };
  }
  return null;
}

/*
  ffmpeg is noisy on stderr even when healthy, so only lines that look like faults are
  retained, and only a bounded number of them. The goal is a diagnosable failure
  message, not a transcript.
*/
function recordPublisherError(sink, text) {
  if (sink.length > 40) return;
  String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && /error|fail|refus|timeout|invalid|unable|could not|denied/i.test(line))
    .forEach((line) => sink.push(`${line}\n`));
}

function publishUrlFor(scenario, streamId) {
  if (scenario.container === 'whip') return whipPublishUrl({ streamId });
  if (scenario.container === 'rtsp') return rtspPublishUrl({ streamId });
  return srtPublishUrl({ streamId, latency: scenario.srtLatency });
}

// Camera capture and encode are separate processes, so this pairs them and presents
// the same {stop, stats} shape the synthetic source returns.
async function startCameraPipeline(scenario, { streamId, epochMs, publisherErrors }) {
  // A previous trial's capture may still be releasing the device.
  await waitForDeviceFree({ device: scenario.cameraDevice });
  const sink = startEncoderSink({
    width: scenario.width,
    height: scenario.height,
    fps: scenario.fps,
    bitrate: scenario.bitrate,
    gop: scenario.gop,
    vbvOverride: buildExtraOutputArgs(scenario),
    container: scenario.container,
    lowLatencyMux: scenario.lowLatencyMux,
    rtspTransport: scenario.rtspTransport,
    publishUrl: publishUrlFor(scenario, streamId),
    onStderr: (text) => recordPublisherError(publisherErrors, text),
  });
  const camera = startCameraSource({
    device: scenario.cameraDevice,
    width: scenario.width,
    height: scenario.height,
    fps: scenario.fps,
    inputFormat: scenario.cameraInputFormat,
    epochMs,
    writeFrame: (frame) => sink.writeFrame(frame),
    onStderr: (text) => recordPublisherError(publisherErrors, text),
  });
  return {
    // Camera first: it must release the device before the next trial opens it, and
    // the encoder can be torn down at leisure once nothing is feeding it.
    async stop() {
      await camera.stop();
      sink.stop();
    },
    stats() {
      return { ...camera.stats(), ...sink.stats() };
    },
  };
}

async function runTrial(scenario, { durationMs, warmupMs, streamSuffix }) {
  const epochMs = Date.now();
  const streamId = `measure-${scenario.name}-${streamSuffix}`;
  const mediamtxLog = [];
  const publisherErrors = [];

  /*
    Everything that allocates is created inside one try with a single finally, because
    a failure between allocations used to leak the media server and the publisher. That
    leak was not a cosmetic problem: the leaked server kept its ports, so every
    remaining scenario in the sweep failed with "port still in use" and one bad trial
    destroyed the whole run.
  */
  let server = null;
  let source = null;
  let pageServer = null;
  let browser = null;
  let result;
  let sourceStats = null;

  try {
    server = await startMediaMtx({
      configPath: path.join(CONFIG_DIR, scenario.mediamtxConfig),
      onLog: (line) => mediamtxLog.push(line.trim()),
    });

    source = scenario.cameraDevice
      ? await startCameraPipeline(scenario, { streamId, epochMs, publisherErrors })
      : startVideoSource({
        width: scenario.width,
        height: scenario.height,
        fps: scenario.fps,
        bitrate: scenario.bitrate,
        gop: scenario.gop,
        vbvOverride: buildExtraOutputArgs(scenario),
        container: scenario.container,
        lowLatencyMux: scenario.lowLatencyMux,
        rtspTransport: scenario.rtspTransport,
        wallclockTimestamps: scenario.wallclockTimestamps,
        publishUrl: publishUrlFor(scenario, streamId),
        epochMs,
        onStderr: (text) => recordPublisherError(publisherErrors, text),
      });

    /*
      Wait for the publisher to actually be live, then settle. The readiness check
      removes a race a fixed sleep could not: WHIP needs ICE and DTLS where SRT needs
      almost nothing, so one sleep length cannot serve both. The settle window that
      follows is still needed, because rate control and the receiver jitter buffer take
      a moment to stabilise and their startup transient would otherwise land in the
      tail percentiles.
    */
    try {
      await waitForPathReady({ pathName: streamId });
    } catch (err) {
      throw new Error([
        err.message,
        'publisher stderr:',
        publisherErrors.join('') || '  (none captured)',
        'mediamtx log tail:',
        mediamtxLog.filter(Boolean).slice(-25).map((line) => `  ${line}`).join('\n') || '  (empty)',
      ].join('\n'));
    }
    await new Promise((resolve) => setTimeout(resolve, warmupMs));

    pageServer = await startPageServer();
    browser = await launchBrowser();

    result = await runBrowserVideoProbe({
      browser,
      pageOrigin: pageServer.origin,
      whepUrl: whepUrl({ streamId }),
      epochMs,
      width: scenario.width,
      height: scenario.height,
      durationMs,
      iceServers: scenario.iceServers,
      playoutDelayHint: scenario.playoutDelayHint,
      jitterBufferTarget: scenario.jitterBufferTarget,
    });
  } finally {
    // Captured before teardown: source is torn down here, so its counters have to be
    // read while it still exists.
    sourceStats = source ? source.stats() : null;
    // Ordered most- to least-dependent, and each guarded, so one failing teardown
    // cannot strand the rest.
    if (source) await Promise.resolve(source.stop()).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (pageServer) await pageServer.stop().catch(() => {});
    if (server) await server.stop().catch(() => {});
  }

  const latencies = result.samples.map((sample) => sample.latencyMs);
  const presented = result.samples.map((sample) => sample.presentedLatencyMs);

  return {
    scenario: scenario.name,
    label: scenario.label,
    settings: {
      gop: scenario.gop,
      bitrate: scenario.bitrate,
      srtLatency: scenario.srtLatency,
      playoutDelayHint: scenario.playoutDelayHint,
      jitterBufferTarget: scenario.jitterBufferTarget,
      bufsizeFrames: scenario.bufsizeFrames,
      noVbv: scenario.noVbv,
      container: scenario.container,
      lowLatencyMux: scenario.lowLatencyMux,
      rtspTransport: scenario.rtspTransport,
      cameraDevice: scenario.cameraDevice,
      iceServerCount: scenario.iceServers.length,
      mediamtxConfig: scenario.mediamtxConfig,
    },
    latency: summarize(latencies),
    presentedLatency: summarize(presented),
    frameInterval: summarize(intervalsFrom(result.samples)),
    attachMs: result.connectMs,
    quality: deriveQuality(result.stats),
    bandwidth: result.bandwidth,
    sourceStats,
    sampleCount: result.samples.length,
  };
}

function formatRow(trial) {
  const quality = trial.quality || {};
  return [
    trial.scenario.padEnd(18),
    String(trial.latency.p50 ?? '-').padStart(7),
    String(trial.latency.p95 ?? '-').padStart(7),
    String(trial.attachMs ?? '-').padStart(8),
    String(trial.bandwidth?.videoKbps ?? '-').padStart(7),
    String(quality.averageQp ?? '-').padStart(6),
    String(quality.meanJitterBufferMs ?? '-').padStart(8),
    String(quality.freezeCount ?? '-').padStart(7),
    String(quality.framesPerSecond ?? '-').padStart(5),
    String(trial.sampleCount).padStart(6),
  ].join(' ');
}

function printTable(trials) {
  console.log('');
  console.log([
    'scenario'.padEnd(18),
    'p50'.padStart(7),
    'p95'.padStart(7),
    'attach'.padStart(8),
    'vkbps'.padStart(7),
    'qp'.padStart(6),
    'jbuf'.padStart(8),
    'freeze'.padStart(7),
    'fps'.padStart(5),
    'n'.padStart(6),
  ].join(' '));
  console.log('-'.repeat(86));
  trials.forEach((trial) => console.log(formatRow(trial)));
  console.log('');
  console.log('p50/p95/attach/jbuf in ms. vkbps is measured steady-state video egress');
  console.log('per viewer - the figure the server upload budget is spent on. qp is the');
  console.log('average quantizer: higher means blockier.');
  console.log('A latency win with a materially higher qp or freeze count is not a win.');
}

function parseArgs(argv) {
  const args = {
    scenarios: [],
    durationMs: 15_000,
    warmupMs: 4_000,
    repeats: 1,
    continuous: false,
    out: null,
    compare: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--continuous') args.continuous = true;
    else if (arg === '--all') args.scenarios = Object.keys(SCENARIOS);
    else if (arg === '--duration') args.durationMs = Number(argv[++index]);
    else if (arg === '--warmup') args.warmupMs = Number(argv[++index]);
    else if (arg === '--repeats') args.repeats = Number(argv[++index]);
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--compare') args.compare = argv[++index];
    else if (arg === '--list') args.list = true;
    else if (arg === '--clean') args.clean = true;
    else if (!arg.startsWith('--')) args.scenarios.push(arg);
  }
  if (!args.scenarios.length) args.scenarios = ['baseline'];
  return args;
}

/*
  Regression comparison. A latency change is only reported as meaningful when it
  clears 5ms, because repeated runs of an identical configuration on a loaded
  workstation drift by a few milliseconds and calling that a win would make the
  harness useless for deciding anything.
*/
const MEANINGFUL_MS = 5;

function compareAgainst(baselinePath, trials) {
  const previous = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const byScenario = new Map((previous.trials || []).map((trial) => [trial.scenario, trial]));
  console.log('');
  console.log(`=== vs ${path.basename(baselinePath)} ===`);
  trials.forEach((trial) => {
    const before = byScenario.get(trial.scenario);
    if (!before) {
      console.log(`${trial.scenario.padEnd(18)} (new)`);
      return;
    }
    const deltaP50 = trial.latency.p50 - before.latency.p50;
    const deltaQp = (trial.quality?.averageQp ?? 0) - (before.quality?.averageQp ?? 0);
    const verdict = Math.abs(deltaP50) < MEANINGFUL_MS
      ? 'no change'
      : `${deltaP50 < 0 ? 'better' : 'WORSE'} by ${Math.abs(Math.round(deltaP50 * 10) / 10)}ms`;
    const beforeKbps = before.bandwidth?.videoKbps;
    const afterKbps = trial.bandwidth?.videoKbps;
    const bandwidthNote = beforeKbps != null && afterKbps != null && Math.abs(afterKbps - beforeKbps) >= 25
      ? `  [egress ${beforeKbps} -> ${afterKbps} kbps]`
      : '';
    const qualityNote = Math.abs(deltaQp) >= 1
      ? `  (qp ${deltaQp > 0 ? '+' : ''}${Math.round(deltaQp * 10) / 10} - quality ${deltaQp > 0 ? 'regressed' : 'improved'})`
      : '';
    console.log(`${trial.scenario.padEnd(18)} p50 ${before.latency.p50} -> ${trial.latency.p50}  ${verdict}${qualityNote}${bandwidthNote}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    Object.entries(SCENARIOS).forEach(([name, scenario]) => {
      console.log(`${name.padEnd(20)} ${scenario.label}`);
      console.log(`${''.padEnd(20)} ${scenario.description}`);
    });
    return;
  }

  if (args.clean) {
    const killed = killHarnessOrphans({ onLog: (line) => console.error(line) });
    console.error(killed ? `cleaned ${killed} orphan process(es)` : 'no harness orphans found');
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  // Held for the whole run. Overlapping runs share fixed ports and silently corrupt
  // each other's measurements.
  acquireRunLock();
  let iteration = 0;

  do {
    iteration += 1;
    const trials = [];
    const failures = [];
    for (const name of args.scenarios) {
      const scenario = resolveScenario(name);
      for (let repeat = 0; repeat < args.repeats; repeat += 1) {
        const suffix = `${iteration}-${repeat}-${Math.floor(process.hrtime()[1] / 1000)}`;
        process.stderr.write(`running ${name}${args.repeats > 1 ? ` (${repeat + 1}/${args.repeats})` : ''}... `);
        /*
          A failing scenario must not discard the scenarios that already succeeded. A
          full sweep is minutes of measurement, and aborting the run on one bad trial
          threw away good data and forced a complete redo. The failure is recorded in
          the results file so it is visible rather than silently missing.
        */
        try {
          const trial = await runTrial(scenario, {
            durationMs: args.durationMs,
            warmupMs: args.warmupMs,
            streamSuffix: suffix,
          });
          process.stderr.write(`p50 ${trial.latency.p50}ms qp ${trial.quality?.averageQp ?? '-'}\n`);
          trials.push(trial);
        } catch (err) {
          const firstLine = String(err.message).split('\n')[0];
          process.stderr.write(`FAILED: ${firstLine}\n`);
          failures.push({ scenario: name, error: err.message });
        }
      }
    }

    if (trials.length) printTable(trials);
    if (failures.length) {
      console.log('');
      console.log(`=== ${failures.length} scenario(s) failed ===`);
      failures.forEach((failure) => {
        console.log(`${failure.scenario}: ${String(failure.error).split('\n')[0]}`);
      });
    }

    const payload = {
      // Stamped after the run so nothing in the measurement depends on the clock.
      recordedAt: new Date().toISOString(),
      iteration,
      durationMs: args.durationMs,
      warmupMs: args.warmupMs,
      trials,
      failures,
    };
    const outPath = args.out
      ? path.resolve(RESULTS_DIR, args.out)
      : path.join(RESULTS_DIR, `run-${Date.now()}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`written: ${path.relative(process.cwd(), outPath)}`);

    if (args.compare) compareAgainst(path.resolve(RESULTS_DIR, args.compare), trials);
    // Non-zero exit so a scripted or scheduled run notices partial results.
    if (failures.length) process.exitCode = 1;
  } while (args.continuous);
}

main().catch((err) => {
  console.error('measure failed:', err.stack || err.message);
  process.exitCode = 1;
});
