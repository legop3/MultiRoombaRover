// Latency Harness Camera Source
// Purpose: Feeds real camera frames through the same timestamped publish path as the synthetic source.
// Scope: Capture and restamping only; encoder settings stay in videoSource.js.
const { spawn } = require('child_process');
const { paintTimecodeRgb24 } = require('./timecode');

/*
  Why a real camera matters for the bitrate question specifically.

  The synthetic source draws smooth gradients, which h264 compresses extremely well.
  A bitrate ladder measured on it would find a knee far below where a real feed finds
  one, because real sensors add noise, and noise is high-entropy and expensive to
  encode. Choosing a production bitrate from synthetic content would under-provision
  the rovers and ship a blocky picture.

  This is a USB webcam, not the OV5647 the rovers use, so it is not a substitute for
  validating on real rover hardware. It is much closer than gradients though: it has
  genuine sensor noise, real lighting response, and real motion, at the same 640x480
  the rovers publish.

  Note this measures pipeline latency from the moment a captured frame is stamped, so
  sensor and USB capture latency are deliberately outside the number. That is the
  right boundary: capture cost is not something this pipeline can tune.
*/
function buildCaptureArgs({ device, width, height, fps, inputFormat }) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-f', 'v4l2',
    ...(inputFormat ? ['-input_format', inputFormat] : []),
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', device,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ];
}

/*
  Reframes the capture byte stream, stamps each frame, and hands it to a sink that
  owns the encoder. Kept separate from videoSource so both sources feed byte-identical
  encoder settings and a source swap cannot silently change encoding too.
*/
/*
  V4L2 allows exactly one opener, and a capture process from a previous trial can still
  be holding the device for a moment after being signalled. Waiting for it beats failing
  the trial: the device becoming free is expected and transient, not an error worth
  discarding a measurement over.
*/
async function waitForDeviceFree({ ffmpegBin = 'ffmpeg', device, timeoutMs = 8000 }) {
  const { execFile } = require('child_process');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = await new Promise((resolve) => {
      execFile(
        ffmpegBin,
        ['-hide_banner', '-loglevel', 'error', '-f', 'v4l2', '-i', device, '-frames:v', '1', '-f', 'null', '-'],
        { timeout: 4000 },
        (err, _stdout, stderr) => resolve(/busy/i.test(String(stderr || err?.message || ''))),
      );
    });
    if (!busy) return true;
    if (Date.now() > deadline) throw new Error(`${device} still busy after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function startCameraSource({
  ffmpegBin = 'ffmpeg',
  device = '/dev/video0',
  width = 640,
  height = 480,
  fps = 30,
  inputFormat = 'mjpeg',
  epochMs,
  writeFrame,
  onStderr,
  onExit,
}) {
  if (typeof writeFrame !== 'function') throw new Error('writeFrame required');
  const proc = spawn(ffmpegBin, buildCaptureArgs({ device, width, height, fps, inputFormat }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const frameBytes = width * height * 3;
  let pending = Buffer.alloc(0);
  let framesForwarded = 0;
  let stopped = false;

  proc.stderr.on('data', (chunk) => onStderr?.(chunk.toString()));
  proc.on('exit', (code, signal) => {
    stopped = true;
    onExit?.(code, signal);
  });

  proc.stdout.on('data', (chunk) => {
    if (stopped) return;
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;

    while (pending.length >= frameBytes) {
      // Copied because the frame is stamped in place and the encoder write is async;
      // reusing the slice would risk mutating a buffer already handed downstream.
      const frame = Buffer.from(pending.subarray(0, frameBytes));
      pending = pending.subarray(frameBytes);

      // Stamped as late as possible so the recorded time is the moment the frame
      // entered the encoder, not when capture started.
      paintTimecodeRgb24(frame, width, height, Date.now() - epochMs);
      writeFrame(frame);
      framesForwarded += 1;
    }
  });

  const exited = new Promise((resolve) => proc.once('exit', resolve));

  return {
    /*
      Resolves only once ffmpeg has actually exited and released the V4L2 device. A
      fire-and-forget kill let the next trial open /dev/video0 while the previous
      capture still held it, which failed with "Device or resource busy" - a harness
      race that looks like a camera fault.
    */
    async stop() {
      stopped = true;
      proc.kill('SIGTERM');
      const timeout = new Promise((resolve) => setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000));
      await Promise.race([exited, timeout]);
      await exited.catch(() => {});
    },
    stats() {
      return { framesForwarded };
    },
    process: proc,
  };
}

module.exports = { startCameraSource, waitForDeviceFree, buildCaptureArgs };
