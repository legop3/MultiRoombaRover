// Latency Harness Video Source
// Purpose: Generates timestamped RGB24 frames and feeds them to an ffmpeg SRT publisher.
// Scope: Owns frame content, pacing, and the encoder command line; measurement lives in the probes.
const { spawn } = require('child_process');
const { paintTimecodeRgb24, layoutFor } = require('./timecode');

/*
  Frame content is deliberately not a static test card. A still image compresses to
  almost nothing, which would let the encoder run far below the configured bitrate
  and hide exactly the bitrate-versus-latency tradeoff being measured. A moving
  pattern keeps the encoder doing realistic work every frame.
*/
function buildFrame(buffer, width, height, frameIndex) {
  const phase = (frameIndex * 6) % width;
  // Content starts below the timecode strip so it can never overwrite the stamp.
  const contentTop = layoutFor(width).stripHeightPx;
  for (let y = contentTop; y < height; y += 1) {
    let offset = (y * width) * 3;
    for (let x = 0; x < width; x += 1) {
      // Diagonal sweep plus a vertical gradient: enough spatial detail to cost
      // bits, enough motion to cost inter-frame bits.
      const sweep = ((x + phase) % width) * 255 / width;
      const band = ((x + y + phase) % 64) < 32 ? 40 : 0;
      buffer[offset] = Math.min(255, sweep + band);
      buffer[offset + 1] = Math.min(255, (y * 255 / height) + band);
      buffer[offset + 2] = Math.min(255, 255 - sweep + band);
      offset += 3;
    }
  }
  return buffer;
}

/*
  Mirrors pi/bin/video-publisher.sh as closely as a synthetic source can. The rover
  hands ffmpeg an already-encoded h264 elementary stream and uses `-c:v copy`; here
  there is no hardware encoder, so libx264 stands in. `-tune zerolatency` is what
  makes that substitution fair: without it x264 holds frames for lookahead and
  would add latency the real rover never pays.
*/
/*
  vbvOverride lets a scenario replace the rate-control block without this module
  needing to know what scenarios exist. Passing {replaceVbv: [...]} substitutes the
  maxrate/bufsize pair; passing {replaceVbv: []} removes the cap entirely.
*/
function buildFfmpegArgs({ width, height, fps, bitrate, gop, publishUrl, vbvOverride = null, container = 'mpegts', rtspTransport = 'tcp', lowLatencyMux = false, wallclockTimestamps = true, extraOutputArgs = [] }) {
  const vbvArgs = vbvOverride
    ? vbvOverride.replaceVbv
    : ['-maxrate', String(bitrate), '-bufsize', String(Math.floor(bitrate / 2))];
  /*
    mpegts is where the measured 160ms lives. These are the ffmpeg-side knobs that
    could account for it: max_interleave_delta bounds how long the muxer will hold a
    packet waiting to interleave another stream, and avioflags direct stops the IO
    layer batching writes. If setting them does not move the number, the delay is on
    MediaMTX's demux side rather than ffmpeg's mux side.
  */
  const muxerArgs = lowLatencyMux
    ? ['-max_interleave_delta', '0', '-avioflags', 'direct', '-max_delay', '0']
    : [];
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', 'nobuffer',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    /*
      The rover sets this because a raw h264 elementary stream carries no timestamps. It is
      measured as a variable here because stamping from the wall clock at read time could in
      principle cost a frame of buffering.
    */
    ...(wallclockTimestamps ? ['-use_wallclock_as_timestamps', '1'] : []),
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-x264-params', `keyint=${gop}:min-keyint=${gop}:scenecut=0:bframes=0:rc-lookahead=0:sliced-threads=1:sync-lookahead=0`,
    '-b:v', String(bitrate),
    ...vbvArgs,
    '-pix_fmt', 'yuv420p',
    '-flush_packets', '1',
    '-muxdelay', '0',
    '-muxpreload', '0',
    ...extraOutputArgs,
    ...muxerArgs,
    /*
      Container choice is a measured variable, not a constant. The rover publishes
      mpegts over SRT; publishing the identical encoded frames over RTSP instead
      separates time spent in the mpegts mux and SRT transport from time spent
      inside MediaMTX after ingest.
    */
    /*
      Transport matters beyond latency. SRT was presumably chosen for a lossy WiFi
      link, and RTSP over TCP would trade that for head-of-line blocking, so UDP
      variants are measured separately.

      whip publishes RTP over ICE/DTLS, the same shape the browsers already receive.
      pkt_size 1200 keeps RTP payloads under a typical 1500-byte MTU so nothing
      fragments on the way out of the rover.
    */
    ...(container === 'whip'
      ? ['-f', 'whip', '-pkt_size', '1200']
      : container === 'rtsp'
        ? ['-f', 'rtsp', '-rtsp_transport', rtspTransport]
        : ['-f', 'mpegts']),
    publishUrl,
  ];
}

function startVideoSource({
  ffmpegBin = 'ffmpeg',
  width = 640,
  height = 480,
  fps = 30,
  bitrate = 2_000_000,
  gop = 120,
  vbvOverride = null,
  container = 'mpegts',
  lowLatencyMux = false,
  rtspTransport = 'tcp',
  wallclockTimestamps = true,
  publishUrl,
  epochMs,
  onExit,
  onStderr,
}) {
  if (!publishUrl) throw new Error('publishUrl required');
  const args = buildFfmpegArgs({ width, height, fps, bitrate, gop, publishUrl, vbvOverride, container, lowLatencyMux, rtspTransport, wallclockTimestamps });
  const proc = spawn(ffmpegBin, args, { stdio: ['pipe', 'ignore', 'pipe'] });

  const frameBytes = width * height * 3;
  const buffer = Buffer.alloc(frameBytes);
  const frameIntervalMs = 1000 / fps;

  let frameIndex = 0;
  let stopped = false;
  let timer = null;
  let framesWritten = 0;
  let framesDropped = 0;

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
  proc.on('exit', (code, signal) => {
    stopped = true;
    if (timer) clearTimeout(timer);
    onExit?.(code, signal);
  });

  const startedAt = Date.now();

  function pump() {
    if (stopped) return;

    /*
      Pacing is computed from the elapsed wall clock rather than by adding a fixed
      interval, so a slow write or GC pause does not permanently shift the frame
      clock and quietly change the effective frame rate mid-measurement.
    */
    const targetIndex = Math.floor((Date.now() - startedAt) / frameIntervalMs);
    if (targetIndex > frameIndex) {
      // Never try to catch up by bursting: that would distort the encoder's view
      // of time. Count the gap instead so the run report can show it.
      framesDropped += targetIndex - frameIndex - 1;
      frameIndex = targetIndex;

      buildFrame(buffer, width, height, frameIndex);
      // Stamped last and as late as possible, so the recorded time is the moment
      // the frame entered the encoder and includes none of the generation cost.
      paintTimecodeRgb24(buffer, width, height, Date.now() - epochMs);
      const ok = proc.stdin.write(buffer);
      framesWritten += 1;
      if (!ok) {
        // Encoder backpressure. Waiting for drain is correct: writing anyway
        // would buffer frames in node and inflate measured latency.
        proc.stdin.once('drain', () => {
          timer = setTimeout(pump, 0);
        });
        return;
      }
    }

    const nextAt = startedAt + (frameIndex + 1) * frameIntervalMs;
    timer = setTimeout(pump, Math.max(0, nextAt - Date.now()));
  }

  pump();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        proc.stdin.end();
      } catch {
        // Already closed; the exit handler owns cleanup.
      }
      proc.kill('SIGTERM');
    },
    stats() {
      return { framesWritten, framesDropped, frameIndex };
    },
    process: proc,
  };
}

/*
  Encoder-only sink. Exposes the same ffmpeg invocation startVideoSource uses, but
  without the synthetic frame generator, so a camera source can feed byte-identical
  encoder settings. Sharing the argument builder is the point: if the two paths built
  their own command lines, a source swap could silently change encoding too and the
  bitrate comparison would be meaningless.
*/
function startEncoderSink({
  ffmpegBin = 'ffmpeg',
  width = 640,
  height = 480,
  fps = 30,
  bitrate = 2_000_000,
  gop = 120,
  vbvOverride = null,
  container = 'mpegts',
  lowLatencyMux = false,
  rtspTransport = 'tcp',
  publishUrl,
  onStderr,
  onExit,
}) {
  if (!publishUrl) throw new Error('publishUrl required');
  const args = buildFfmpegArgs({
    width, height, fps, bitrate, gop, publishUrl, vbvOverride, container, lowLatencyMux, rtspTransport,
  });
  const proc = spawn(ffmpegBin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let framesWritten = 0;
  let backpressureEvents = 0;

  proc.stderr.on('data', (chunk) => onStderr?.(chunk.toString()));
  proc.stdin.on('error', (err) => {
    // Same reason as startVideoSource: a rejected publish must surface as the server's error,
    // not as an unhandled EPIPE.
    if (err.code !== 'EPIPE') onStderr?.(`stdin error: ${err.message}\n`);
  });
  proc.on('exit', (code, signal) => onExit?.(code, signal));

  return {
    writeFrame(frame) {
      if (proc.exitCode !== null || proc.signalCode) return;
      // Dropping on backpressure rather than queueing: a queued frame would sit in
      // node and arrive stamped with an old time, inflating measured latency with
      // delay the pipeline did not cause.
      if (!proc.stdin.write(frame)) backpressureEvents += 1;
      framesWritten += 1;
    },
    stop() {
      try {
        proc.stdin.end();
      } catch {
        // Already closed.
      }
      proc.kill('SIGTERM');
    },
    stats() {
      return { framesWritten, backpressureEvents };
    },
    process: proc,
  };
}

module.exports = { startVideoSource, startEncoderSink, buildFfmpegArgs, buildFrame };
