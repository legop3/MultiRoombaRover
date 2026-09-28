// One bounded recording session. Video packets retain receiver wall-clock PTS;
// telemetry uses the same server clock, not an assumed browser playback clock.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { controlProfile } = require('./capabilities');

const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

async function saveMetadata(directory, metadata) {
  const filename = path.join(directory, 'session.json');
  await fsp.writeFile(`${filename}.tmp`, JSON.stringify(metadata, null, 2));
  await fsp.rename(`${filename}.tmp`, filename);
}

async function createRecording({ root, roverId, snapshot, logger, docked = false }) {
  const id = `${Date.now()}-${randomUUID()}`;
  const directory = path.join(root, id);
  await fsp.mkdir(directory);
  const metadata = {
    version: 1, id, roverId, startedAt: Date.now(), endedAt: null,
    controlProfile: controlProfile(snapshot.meta), wheelSpeedLimit: snapshot.meta?.maxWheelSpeed ?? 500,
    timing: 'Video PTS uses server receiver Unix seconds. Events use Unix milliseconds and process monotonic nanoseconds. Browser display delay is not measured.',
    video: { file: 'video.mkv', codec: 'source-copy', timestampUnit: 'seconds', origin: 'unix' },
    events: 'events.ndjson', droppedEvents: 0, bufferOnly: docked,
    trainingStartedAt: docked ? null : Date.now(),
  };
  await saveMetadata(directory, metadata);
  const output = fs.createWriteStream(path.join(directory, 'events.ndjson'), { flags: 'wx' });
  let buffered = [];
  let bufferedBytes = 0;
  let dockedAt = null;
  let pruning = Promise.resolve();
  let failure = null;
  let stopping = false;
  let stopPromise;
  let child;
  let childClosed = false;
  let stderr = '';
  let videoResult = null;
  let resolveVideo;
  const videoClosed = new Promise((resolve) => { resolveVideo = resolve; });
  output.on('error', (error) => {
    failure = error.message;
    // Stop file growth immediately when telemetry is no longer writable.
    child?.kill('SIGTERM');
  });

  function append(kind, data, timestamp = {}) {
    if (stopping || failure) return false;
    try {
      const line = JSON.stringify({
        ts: Date.now(), monotonicNs: process.hrtime.bigint().toString(), ...timestamp, kind, data,
      }) + '\n';
      if (metadata.bufferOnly) {
        const now = Date.now();
        buffered.push({ at: now, line });
        bufferedBytes += Buffer.byteLength(line);
        while (buffered.length && buffered[0].at < now - 5000) {
          bufferedBytes -= Buffer.byteLength(buffered.shift().line);
        }
        while (bufferedBytes > MAX_BUFFER_BYTES && buffered.length) {
          metadata.droppedEvents += 1;
          bufferedBytes -= Buffer.byteLength(buffered.shift().line);
        }
        return true;
      }
      // Never wait for disk from a control/sensor callback. Explicit loss counts
      // prevent an overloaded recorder from pretending its history is complete.
      if (output.writableLength + Buffer.byteLength(line) > MAX_BUFFER_BYTES) {
        metadata.droppedEvents += 1;
        return true;
      }
      output.write(line);
    } catch (error) {
      metadata.droppedEvents += 1;
      failure = error.message;
      child?.kill('SIGTERM');
    }
    return true;
  }

  append('snapshot', snapshot);
  // Read the local published stream, as replay does, without depending on the
  // replay service or re-encoding camera video. No audio/chat is captured.
  child = spawn(process.env.FFMPEG_BIN || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-n',
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-use_wallclock_as_timestamps', '1', '-copyts',
    '-i', `rtsp://127.0.0.1:8554/${encodeURIComponent(roverId)}`,
    '-map', '0:v:0', '-an', '-c:v', 'copy', '-avoid_negative_ts', 'disabled',
    // Keyframe-aligned chunks keep a disposable dock buffer without repeatedly
    // reconnecting to RTSP. Extra edge packets are filtered by trainingStartedAt.
    '-f', 'segment', '-segment_time', '2', '-segment_format', 'matroska',
    '-reset_timestamps', '0', path.join(directory, 'video-%09d.mkv'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.on('error', (error) => { failure = error.message; });
  child.once('close', (code, signal) => {
    childClosed = true;
    videoResult = { code, signal, stderr };
    if (!stopping) failure ||= `Video recorder exited (${code ?? signal})`;
    resolveVideo();
  });

  function updateDock(isDocked) {
    if (stopping) return;
    if (!isDocked) {
      dockedAt = null;
      if (metadata.bufferOnly) {
        metadata.bufferOnly = false;
        metadata.trainingStartedAt = Date.now() - 5000;
        for (const item of buffered) output.write(item.line);
        buffered = [];
        bufferedBytes = 0;
      }
    } else if (!metadata.bufferOnly && dockedAt == null) dockedAt = Date.now();
  }

  function pruneBuffer() {
    pruning = pruning.then(async () => {
      if (!metadata.bufferOnly || stopping) return;
      const files = (await fsp.readdir(directory)).filter((name) => /^video-\d+\.mkv$/.test(name)).sort();
      // Never unlink the open segment; retain five seconds plus the preceding
      // keyframe segment so the decoder can recover the full lead-in.
      for (const name of files.slice(0, -2)) {
        const filename = path.join(directory, name);
        const stat = await fsp.stat(filename);
        if (!metadata.bufferOnly || stopping) return;
        if (stat.mtimeMs < Date.now() - 5000) await fsp.unlink(filename);
      }
    }).catch((error) => { failure = error.message; child.kill('SIGTERM'); });
  }

  async function stop(reason) {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      append('sessionEnd', { reason, droppedEvents: metadata.droppedEvents });
      stopping = true;
      if (!childClosed) child.kill('SIGTERM');
      // A stuck RTSP read must not leave a recorder behind after disable.
      const killTimer = setTimeout(() => { if (!childClosed) child.kill('SIGKILL'); }, 2000);
      await videoClosed;
      await pruning;
      clearTimeout(killTimer);
      await new Promise((resolve) => {
        if (output.closed) return resolve();
        output.once('close', resolve);
        output.end();
      });
      if (metadata.bufferOnly) {
        await fsp.rm(directory, { recursive: true, force: true });
        return;
      }
      metadata.video.files = (await fsp.readdir(directory)).filter((name) => /^video-\d+\.mkv$/.test(name)).sort();
      metadata.endedAt = Date.now();
      metadata.reason = reason;
      metadata.error = failure;
      metadata.video.result = videoResult;
      await saveMetadata(directory, metadata);
      if (failure) logger.warn('Recording session incomplete', { roverId, id, error: failure, stderr });
    })();
    return stopPromise;
  }

  return {
    id, directory, startedAt: metadata.startedAt, append, stop, updateDock, pruneBuffer,
    get buffered() { return metadata.bufferOnly; },
    get dockTailComplete() { return dockedAt != null && Date.now() - dockedAt >= 5000; },
    get trainingStartedAt() { return metadata.trainingStartedAt; },
    get failed() { return Boolean(failure); },
    get stopping() { return stopping; },
    getStatus: () => ({ id, roverId, startedAt: metadata.startedAt, droppedEvents: metadata.droppedEvents,
      video: childClosed ? 'stopped' : metadata.bufferOnly ? 'Dock lead-in buffer' : 'Recording human driving', error: failure, stopping }),
    // Process exit is synchronous; normal disable uses stop() and awaits close.
    kill: () => { if (!childClosed) child.kill('SIGKILL'); },
  };
}

module.exports = { createRecording, saveMetadata };
