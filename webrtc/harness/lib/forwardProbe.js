// Latency Harness Forward-Audio Probe
// Purpose: Detects tone-burst onsets where the rover would play them, measuring the browser-to-rover uplink.
// Scope: Replicates pi/bin/audio-forward-listener.sh exactly; the burst grid is generated in the browser.
const { spawn } = require('child_process');

/*
  Byte-for-byte the ffmpeg invocation from pi/bin/audio-forward-listener.sh, decoding to the
  same 16kHz mono s16le that gets piped into aplay.

  This matters for interpretation. On the download side, reading the stream back with ffmpeg
  was a measurement artifact worth ~210ms and had to be discarded. Here it is the opposite:
  ffmpeg reading the forwarded stream and decoding it to PCM *is the rover's implementation*,
  so its cost is latency a real listener genuinely pays. Nothing needs subtracting.

  What is still outside the number: ALSA's playback buffer inside aplay, and the speaker
  itself. So this is browser-to-rover-PCM rather than browser-to-audible, and it is a lower
  bound on what a person in the room hears.
*/
function buildForwardReadArgs(readUrl, { normalizeFilter = null } = {}) {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-analyzeduration', '200k',
    '-probesize', '32k',
    '-i', readUrl,
    '-vn',
  ];
  // The rover applies loudness normalisation when configured. It is a filter in the audio
  // path, so it can add latency and belongs in a faithful reproduction.
  if (normalizeFilter) args.push('-af', normalizeFilter);
  args.push('-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1');
  return args;
}

const SAMPLE_RATE = 16_000;

/*
  Envelope follower with the same shape as the browser-side detector: fast attack so an onset
  is not reported late, slow release so a burst's tail cannot retrigger as a second onset.
*/
function createOnsetDetector({ onOnset, threshold = 0.06, rearmBelow = 0.015 }) {
  let envelope = 0;
  let armed = true;
  let sampleCursor = 0;

  return function feed(buffer) {
    for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
      const sample = buffer.readInt16LE(offset) / 32768;
      const magnitude = Math.abs(sample);
      const coefficient = magnitude > envelope ? 0.45 : 0.002;
      envelope += (magnitude - envelope) * coefficient;

      if (envelope > threshold && armed) {
        armed = false;
        onOnset(sampleCursor);
      } else if (envelope < rearmBelow && !armed) {
        armed = true;
      }
      sampleCursor += 1;
    }
  };
}

function startForwardProbe({
  ffmpegBin = 'ffmpeg',
  readUrl,
  normalizeFilter = null,
  onSample,
  onStderr,
}) {
  const proc = spawn(ffmpegBin, buildForwardReadArgs(readUrl, { normalizeFilter }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onsets = [];
  let bytesSeen = 0;
  let pending = Buffer.alloc(0);

  /*
    Onset arrival is timestamped on receipt of the containing chunk rather than derived from
    the decoded sample position. The sample cursor only counts what ffmpeg has emitted, so it
    cannot see time spent waiting for data; wall clock at receipt can.
  */
  const feed = createOnsetDetector({
    onOnset: (sampleCursor) => {
      const sample = {
        at: Date.now(),
        sampleCursor,
        decodedMs: Math.round((sampleCursor / SAMPLE_RATE) * 1000),
      };
      onsets.push(sample);
      onSample?.(sample);
    },
  });

  proc.stderr.on('data', (chunk) => onStderr?.(chunk.toString()));
  proc.stdout.on('data', (chunk) => {
    bytesSeen += chunk.length;
    // s16le samples are 2 bytes; carry an odd trailing byte to the next chunk rather than
    // misaligning every subsequent sample.
    const combined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = combined.length - (combined.length % 2);
    feed(combined.subarray(0, usable));
    pending = combined.subarray(usable);
  });

  return {
    stop() {
      proc.kill('SIGTERM');
    },
    onsets,
    stats() {
      return { bytesSeen, onsets: onsets.length, seconds: Math.round((bytesSeen / 2 / SAMPLE_RATE) * 10) / 10 };
    },
    process: proc,
  };
}

/*
  Attributes each detected onset to the grid slot the browser generated it in, and reports
  the difference. Both ends read the same wall clock because this is one machine, so no
  synchronisation term is needed.

  ALIASING IS THE TRAP HERE, and it produced a false result during development.

  Rounding to the nearest slot means a true latency of one interval plus a little is
  indistinguishable from a little. With a 1000ms grid, an actual 1016ms was reported as
  16.7ms, which looked like a spectacular win, and an actual ~979ms was reported as -21ms.
  The negative value is what gave it away: latency cannot be negative, so any negative
  reading is proof the attribution wrapped.

  Two defences now:
    - latency is measured forward only. An onset is attributed to the most recent slot at or
      before it, so a genuine result can never come out negative, and a negative would now
      indicate a clock or anchor fault rather than being silently absorbed.
    - anything within `guardMs` of either end of the window is flagged ambiguous, because
      near the boundary the slot choice is not safe.

  The real fix is on the caller's side: use a grid interval comfortably larger than twice the
  latency being measured. loudnorm alone buffers about a second, so a 1000ms grid was never
  going to be enough.
*/
function attributeOnsets({ onsets, startWallMs, intervalMs, guardMs = 150 }) {
  return onsets.map((onset) => {
    const sinceStart = onset.at - startWallMs;
    // Floor, not round: attribute to the slot that has already happened.
    const slot = Math.floor(sinceStart / intervalMs);
    const expectedAt = startWallMs + slot * intervalMs;
    const latencyMs = onset.at - expectedAt;
    return {
      ...onset,
      slot,
      latencyMs: Math.round(latencyMs * 10) / 10,
      // Close to the next slot means the true value may belong to it instead.
      ambiguous: latencyMs < 0 || latencyMs > intervalMs - guardMs,
      negative: latencyMs < 0,
    };
  });
}

/*
  Bimodality is the visible symptom of aliasing, and a percentile hides it: half the samples
  at 16ms and half at 136ms produce a plausible-looking p50.

  Detection looks for an actual GAP in the sorted samples rather than a wide range. The first
  version compared the range against the median and cried wolf on a genuinely single-cluster
  result that merely had ordinary variance - 30ms median with a 60ms range is one noisy
  distribution, not two. Aliased samples, by contrast, sit near 0 and near the grid interval
  with nothing between, so a large empty gap is the real signature.
*/
function describeSpread(values, { intervalMs = null } = {}) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length < 4) return null;

  let largestGap = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    largestGap = Math.max(largestGap, sorted[index] - sorted[index - 1]);
  }
  const range = sorted[sorted.length - 1] - sorted[0];
  /*
    A gap wider than a quarter of the grid interval means two populations far enough apart to
    be different slots. Without a known interval, fall back to a gap that dominates the range.
  */
  const threshold = intervalMs ? intervalMs / 4 : Math.max(50, range * 0.6);
  return {
    range: Math.round(range * 10) / 10,
    largestGap: Math.round(largestGap * 10) / 10,
    suspiciousSpread: largestGap > threshold,
  };
}

module.exports = { startForwardProbe, buildForwardReadArgs, attributeOnsets, describeSpread, SAMPLE_RATE };
