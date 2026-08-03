#!/usr/bin/env node
/*
  Purpose: Measure what each additional WHEP viewer costs, in server upload and in latency.
  Scope: One publisher, N concurrent viewers of the same stream. Video only.

  Everything else in this harness measures a single viewer, which answers "how fast is one
  stream" but not "what happens when four people watch". Those are different questions and the
  second one is the one that decides whether the production server's upload budget holds:
  MediaMTX fans a stream out per viewer, so egress is expected to be N times ingress. This
  measures whether that is actually what happens, and whether latency survives it.

  The important confound is local, not remote. Every viewer here is a real Chromium decoding
  real h264 on this machine, so at high N the measurement host saturates before the server
  does, and the resulting latency rise looks exactly like server congestion. Two independent
  signals separate them:

    - `framesDiscarded` from MediaMTX. This is the server's own admission that it could not
      send what it wanted to. If it stays zero, the server is not the bottleneck regardless of
      what the latency numbers do.
    - local CPU, sampled across the window from /proc/stat. If that approaches saturation,
      treat the latency figures as a property of this machine and not of the server.

  Without both, a rise in p50 at N=8 is uninterpretable.

  Usage:
    node measure-concurrency.js [--viewers 1,2,4,8] [--container rtsp|whip|mpegts]
                               [--duration 20000] [--warmup 5000] [--out name.json]

    MEDIA_METRICS_URL, if set, is MediaMTX's Prometheus endpoint. It is loopback-bound on a
    deployed server, so reach it over the same SSH tunnel as the API:
      ssh -N -L 15946:127.0.0.1:15946 host &
      MEDIA_METRICS_URL=http://127.0.0.1:15946/metrics ...
    Without it the run still measures per-viewer cost from the browser side; it just cannot
    report the server's own view.
*/
const fs = require('fs');
const http = require('http');
const path = require('path');

const {
  startMediaMtx, rtspPublishUrl, srtPublishUrl, whipPublishUrl, whepUrl,
  waitForPathReady, acquireRunLock, killHarnessOrphans, mediaTarget, REPO_WEBRTC_DIR,
} = require('./lib/stack');
const { startVideoSource } = require('./lib/videoSource');
const { startPageServer } = require('./lib/pageServer');
const { launchBrowser, runBrowserVideoProbe, deriveQuality } = require('./lib/browserProbe');

const CONFIG_DIR = path.join(REPO_WEBRTC_DIR, 'config');
const RESULTS_DIR = path.join(REPO_WEBRTC_DIR, 'results');

const DEFAULTS = {
  width: 640,
  height: 480,
  fps: 30,
  bitrate: 2_000_000,
  gop: 120,
};

function parseArgs(argv) {
  const options = {
    viewers: [1, 2, 4, 8],
    container: 'rtsp',
    durationMs: 20_000,
    warmupMs: 5_000,
    out: null,
    clean: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--viewers') { options.viewers = argv[i += 1].split(',').map((n) => Number(n.trim())); continue; }
    if (arg === '--container') { options.container = argv[i += 1]; continue; }
    if (arg === '--duration') { options.durationMs = Number(argv[i += 1]); continue; }
    if (arg === '--warmup') { options.warmupMs = Number(argv[i += 1]); continue; }
    if (arg === '--out') { options.out = argv[i += 1]; continue; }
    if (arg === '--clean') { options.clean = true; continue; }
    throw new Error(`Unknown argument "${arg}"`);
  }
  if (options.viewers.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error('--viewers takes a comma-separated list of positive integers');
  }
  return options;
}

function publishUrlFor(container, streamId) {
  if (container === 'whip') return whipPublishUrl({ streamId });
  if (container === 'rtsp') return rtspPublishUrl({ streamId });
  if (container === 'mpegts') return srtPublishUrl({ streamId, latency: 10 });
  throw new Error(`Unknown container "${container}"`);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function fetchText(url, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${url} returned ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`${url} timed out`)));
  });
}

/*
  Parses one Prometheus metric family into a map of label set to value.

  The label set has to be kept rather than summed away, because MediaMTX's per-session metrics
  are labelled by session id and the set of live sessions changes between samples. Summing
  across sessions and differencing the sums produces *negative* egress the moment a session
  closes, since that session's bytes leave the total - which is exactly what the first version
  of this script reported at 4 and 8 viewers. A negative byte count is impossible, so it was the
  measurement that was wrong, not the server.

  With the label sets preserved, per-session deltas can be taken only over sessions present in
  both samples, which is the only differencing that means anything for a per-session gauge.
*/
function parseSamples(text, name) {
  const samples = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    // Guard against a prefix match: webrtc_sessions must not match
    // webrtc_sessions_outbound_bytes. A real sample continues with '{' or whitespace.
    if (rest && !/^[{\s]/.test(rest)) continue;
    const labelEnd = rest.startsWith('{') ? rest.indexOf('}') : -1;
    const labels = labelEnd >= 0 ? rest.slice(1, labelEnd) : '';
    const value = Number(line.trim().split(/\s+/).pop());
    if (Number.isFinite(value)) samples.set(labels, value);
  }
  return samples;
}

function sumSamples(samples) {
  let total = 0;
  for (const value of samples.values()) total += value;
  return total;
}

// Sums deltas only over label sets present in both readings. Sessions that appeared or
// disappeared mid-window are excluded rather than counted as a jump or a drop.
function deltaOverCommon(before, after) {
  let total = 0;
  let common = 0;
  for (const [labels, afterValue] of after) {
    if (!before.has(labels)) continue;
    total += afterValue - before.get(labels);
    common += 1;
  }
  return { total, common };
}

async function readServerMetrics(metricsUrl) {
  if (!metricsUrl) return null;
  const text = await fetchText(metricsUrl);
  return {
    sessions: parseSamples(text, 'webrtc_sessions'),
    sessionOutboundBytes: parseSamples(text, 'webrtc_sessions_outbound_bytes'),
    framesDiscarded: parseSamples(text, 'webrtc_sessions_outbound_frames_discarded'),
    rtpPacketsSent: parseSamples(text, 'webrtc_sessions_rtp_packets_sent'),
    rtpPacketsLost: parseSamples(text, 'webrtc_sessions_rtp_packets_lost'),
    // Per-path rather than per-session, so it survives session churn and is the authoritative
    // total: it is the byte count the server's upload link actually carried for this stream.
    pathOutboundBytes: parseSamples(text, 'paths_outbound_bytes'),
    at: Date.now(),
  };
}

/*
  Local CPU from /proc/stat rather than sampling `top`: two absolute readings differenced over a
  known window give a true average for that window, where an instantaneous sample can land on a
  spike and misrepresent the whole run.
*/
function readCpuJiffies() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] || 0);
  const total = fields.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

function cpuBusyFraction(before, after) {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (totalDelta <= 0) return null;
  return (totalDelta - idleDelta) / totalDelta;
}

async function runViewerSet({ viewerCount, options, streamId, epochMs, metricsUrl, browser, pageOrigin }) {
  const cpuBefore = readCpuJiffies();
  const startedAt = Date.now();

  /*
    All viewers are launched together and each measures its own window. Their windows are
    offset by however long attach takes, a few hundred ms, so they overlap for nearly the whole
    duration - which is what "N concurrent viewers" requires.

    The server-side sample is taken from the middle of that common window rather than around the
    whole run, so it cannot include the period when only some viewers had attached. Bytes
    accumulated during attach would otherwise be divided by the full viewer count and understate
    per-viewer cost.
  */
  const probes = Array.from({ length: viewerCount }, (_, index) => runBrowserVideoProbe({
    browser,
    pageOrigin,
    whepUrl: whepUrl({ streamId }),
    epochMs,
    width: options.width,
    height: options.height,
    durationMs: options.durationMs,
  }).then(
    (value) => ({ ok: true, index, value }),
    (error) => ({ ok: false, index, error: error.message }),
  ));

  const settleMs = Math.min(6_000, Math.floor(options.durationMs / 3));
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const metricsOpening = await readServerMetrics(metricsUrl).catch(() => null);
  const sampleWindowMs = Math.max(4_000, Math.floor(options.durationMs / 3));
  await new Promise((resolve) => setTimeout(resolve, sampleWindowMs));
  const metricsClosing = await readServerMetrics(metricsUrl).catch(() => null);

  const settled = await Promise.all(probes);
  const cpuAfter = readCpuJiffies();

  const failures = settled.filter((entry) => !entry.ok);
  const succeeded = settled.filter((entry) => entry.ok).map((entry) => entry.value);

  const perViewer = succeeded.map((result) => {
    const latencies = result.samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
    // deriveQuality returns null when the inbound video track never appeared, which is a
    // real outcome under concurrency rather than an error, so every field is read defensively.
    const quality = deriveQuality(result.stats) || {};
    return {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      samples: latencies.length,
      videoKbps: result.bandwidth?.videoKbps ?? null,
      connectMs: result.connectMs,
      freezeCount: quality.freezeCount ?? null,
      averageQp: quality.averageQp ?? null,
      fps: quality.framesPerSecond ?? null,
      meanJitterBufferMs: quality.meanJitterBufferMs ?? null,
      packetsLost: quality.packetsLost ?? null,
    };
  });

  let server = null;
  if (metricsOpening && metricsClosing) {
    const elapsedMs = metricsClosing.at - metricsOpening.at;
    /*
      null rather than 0 when nothing could be differenced. A label set can change without the
      stream changing - paths_outbound_bytes carries state="ready" in its labels - and reporting
      0 kbps for "could not compare" would read as "the server sent nothing", which is a
      different and alarming claim.
    */
    const perMs = ({ total, common }) => {
      if (!common || !(elapsedMs > 0)) return null;
      return Math.round((total * 8) / elapsedMs);
    };
    const pathDelta = deltaOverCommon(metricsOpening.pathOutboundBytes, metricsClosing.pathOutboundBytes);
    const sessionDelta = deltaOverCommon(metricsOpening.sessionOutboundBytes, metricsClosing.sessionOutboundBytes);
    const discarded = deltaOverCommon(metricsOpening.framesDiscarded, metricsClosing.framesDiscarded);
    const lost = deltaOverCommon(metricsOpening.rtpPacketsLost, metricsClosing.rtpPacketsLost);
    const sent = deltaOverCommon(metricsOpening.rtpPacketsSent, metricsClosing.rtpPacketsSent);
    server = {
      windowMs: elapsedMs,
      liveSessions: metricsClosing.sessions.size,
      // Both are reported. They should agree closely, and if they diverge the per-session view
      // lost sessions to churn, which is a reason to distrust that row rather than the server.
      egressKbps: perMs(pathDelta),
      sessionEgressKbps: perMs(sessionDelta),
      sessionsDifferenced: sessionDelta.common,
      framesDiscarded: discarded.total,
      rtpPacketsLost: lost.total,
      rtpPacketsSent: sent.total,
    };
  }

  return {
    viewerCount,
    attached: succeeded.length,
    failures,
    perViewer,
    server,
    localCpuBusy: cpuBusyFraction(cpuBefore, cpuAfter),
    wallMs: Date.now() - startedAt,
  };
}

function aggregate(entry) {
  const values = entry.perViewer.map((viewer) => viewer.p50).filter((value) => value !== null).sort((a, b) => a - b);
  const kbps = entry.perViewer.map((viewer) => viewer.videoKbps).filter((value) => value !== null);
  return {
    medianP50: percentile(values, 0.5),
    worstP50: values.length ? values[values.length - 1] : null,
    meanKbps: kbps.length ? Math.round(kbps.reduce((a, b) => a + b, 0) / kbps.length) : null,
    totalKbps: kbps.length ? Math.round(kbps.reduce((a, b) => a + b, 0)) : null,
    freezes: entry.perViewer.reduce((sum, viewer) => sum + (viewer.freezeCount || 0), 0),
  };
}

function report(entries) {
  const rows = entries.map((entry) => ({ entry, agg: aggregate(entry) }));
  const lines = [];
  lines.push('');
  lines.push(' viewers  attached  p50(med)  p50(worst)  kbps/viewer  client total  path egress  sess egress  discarded  lost  cpu');
  lines.push('---------------------------------------------------------------------------------------------------------------------');
  for (const { entry, agg } of rows) {
    const cpu = entry.localCpuBusy === null ? '-' : `${Math.round(entry.localCpuBusy * 100)}%`;
    const cell = (value) => (value === null || value === undefined ? '-' : String(value));
    lines.push([
      String(entry.viewerCount).padStart(8),
      String(entry.attached).padStart(10),
      cell(agg.medianP50).padStart(10),
      cell(agg.worstP50).padStart(12),
      cell(agg.meanKbps).padStart(13),
      cell(agg.totalKbps).padStart(14),
      cell(entry.server?.egressKbps).padStart(13),
      cell(entry.server?.sessionEgressKbps).padStart(13),
      cell(entry.server?.framesDiscarded).padStart(11),
      cell(entry.server?.rtpPacketsLost).padStart(6),
      cpu.padStart(5),
    ].join(''));
  }
  lines.push('');
  lines.push('p50 in ms, measured per viewer then summarised across viewers. kbps/viewer is what one');
  lines.push('viewer costs in server upload; client total is the sum the browsers actually received.');
  lines.push('');
  lines.push('path egress is MediaMTX\'s per-path outbound counter and is the authoritative server');
  lines.push('figure - it survives session churn and includes RTP overhead the browser does not see.');
  lines.push('sess egress sums the per-session counters over sessions present in both samples; it is');
  lines.push('shown alongside as a cross-check, and a large divergence means session churn ate part');
  lines.push('of that window rather than meaning the server misbehaved.');
  lines.push('');
  lines.push('discarded is MediaMTX dropping frames it could not send - the server\'s own congestion');
  lines.push('signal. Zero means the server kept up. cpu is this measuring machine, not the server:');
  lines.push('if it nears saturation the latency column describes this host, not the deployment.');
  return lines.join('\n');
}

async function main() {
  const options = { ...DEFAULTS, ...parseArgs(process.argv.slice(2)) };
  const target = mediaTarget();
  const metricsUrl = process.env.MEDIA_METRICS_URL || null;

  if (options.clean) killHarnessOrphans();
  const releaseLock = acquireRunLock();

  const epochMs = Date.now();
  const streamId = `concurrency-${options.container}-${process.pid}`;
  const publisherErrors = [];
  const mediamtxLog = [];

  let server = null;
  let source = null;
  let pageServer = null;
  let browser = null;
  const entries = [];

  try {
    if (target.managed) {
      server = await startMediaMtx({
        configPath: path.join(CONFIG_DIR, options.container === 'mpegts' ? 'mediamtx-baseline.yml' : 'mediamtx-rtsp-probe.yml'),
        onLog: (line) => mediamtxLog.push(line.trim()),
      });
    }

    source = startVideoSource({
      width: options.width,
      height: options.height,
      fps: options.fps,
      bitrate: options.bitrate,
      gop: options.gop,
      container: options.container,
      rtspTransport: 'tcp',
      publishUrl: publishUrlFor(options.container, streamId),
      epochMs,
      onStderr: (text) => { publisherErrors.push(text); },
    });

    try {
      await waitForPathReady({ pathName: streamId });
    } catch (err) {
      throw new Error([err.message, 'publisher stderr:', publisherErrors.join('') || '  (none)'].join('\n'));
    }
    await new Promise((resolve) => setTimeout(resolve, options.warmupMs));

    pageServer = await startPageServer();
    browser = await launchBrowser();

    /*
      The ladder runs against one continuously published stream. Republishing per step would
      make each step pay a fresh encoder ramp and a fresh keyframe burst, and that transient
      would show up as a latency difference that had nothing to do with viewer count.
    */
    for (const viewerCount of options.viewers) {
      process.stdout.write(`running ${viewerCount} viewer${viewerCount === 1 ? '' : 's'}... `);
      try {
        const entry = await runViewerSet({
          viewerCount, options, streamId, epochMs, metricsUrl, browser, pageOrigin: pageServer.origin,
        });
        entries.push(entry);
        const agg = aggregate(entry);
        process.stdout.write(`p50 ${agg.medianP50}ms, ${entry.attached}/${viewerCount} attached\n`);
      } catch (err) {
        // One failing step must not discard the steps already measured.
        process.stdout.write(`FAILED: ${err.message}\n`);
        entries.push({ viewerCount, attached: 0, failures: [{ error: err.message }], perViewer: [], server: null, localCpuBusy: null });
      }
    }
  } finally {
    if (source) await Promise.resolve(source.stop()).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (pageServer) await pageServer.stop().catch(() => {});
    if (server) await server.stop().catch(() => {});
    releaseLock();
  }

  console.log(report(entries));

  const payload = {
    startedAt: new Date(epochMs).toISOString(),
    target: { host: target.host, isRemote: target.isRemote, ports: target.ports },
    options: { ...options, metricsUrl: metricsUrl ? 'set' : null },
    entries,
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, options.out || `concurrency-${epochMs}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`written: ${path.relative(process.cwd(), outPath)}`);

  if (entries.some((entry) => entry.attached < entry.viewerCount)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`concurrency measure failed: ${err.stack || err.message}`);
  process.exitCode = 1;
});
