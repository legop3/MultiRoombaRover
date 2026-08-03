// audio Forward Service worker engine
// Purpose: Owns ffmpeg worker lifecycle, upload playback, and WHIP/session ownership transitions.
// Scope: Keeps runtime behavior unchanged while isolating process/file-pipeline logic from service wiring.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function createAudioForwardWorkerEngine(deps) {
  const {
    logger,
    io,
    roverManager,
    turnService,
    videoSessions,
    serviceEnabled,
    ffmpegBin,
    runtimeDir,
    uploadsDir,
    maxUploadBytes,
    workers,
    whipOwners,
    setState,
    resolveForwardUrl,
    resolveForwardPublishTarget,
    resolveForwardPathId,
  } = deps;

  function ensureRuntimeDir() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  function sanitizeRoverId(roverId) {
    return String(roverId || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  }

  function sanitizeFileStem(name) {
    return String(name || 'upload')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  function extFromUpload(name, mime) {
    const lowerName = String(name || '').toLowerCase();
    const lowerMime = String(mime || '').toLowerCase();
    if (lowerName.endsWith('.mp3') || lowerMime === 'audio/mpeg' || lowerMime === 'audio/mp3') return '.mp3';
    if (lowerName.endsWith('.wav') || lowerMime === 'audio/wav' || lowerMime === 'audio/x-wav') return '.wav';
    if (lowerName.endsWith('.ogg') || lowerMime === 'audio/ogg') return '.ogg';
    throw new Error('Unsupported upload format (allowed: mp3, wav, ogg)');
  }

  function ensureFifo(fifoPath) {
    try {
      const stat = fs.statSync(fifoPath);
      if (stat.isFIFO()) return;
      fs.unlinkSync(fifoPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const result = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`mkfifo failed: ${result.stderr || result.stdout || 'unknown error'}`);
    }
  }

  function spawnFfmpeg(roverId, tag, args, options = {}) {
    const proc = spawn(ffmpegBin, args, {
      stdio: [options.captureStdin ? 'pipe' : 'ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
    });
    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (!text) return;
      logger.warn(`${tag} stderr`, { roverId, text });
    });
    proc.on('error', (err) => {
      logger.warn(`${tag} spawn error`, { roverId, message: err?.message || String(err) });
    });
    return proc;
  }

  function stopProc(proc, graceMs = 1200) {
    if (!proc || proc.exitCode != null || proc.signalCode != null) return;
    let exited = false;
    const markExited = () => {
      exited = true;
    };
    // ChildProcess.killed only means Node successfully sent a signal, not that
    // ffmpeg actually exited. Track the real exit event so FIFO/SRT hangs still
    // get escalated to SIGKILL instead of making systemd wait for its timeout.
    proc.once('exit', markExited);
    try {
      proc.kill('SIGTERM');
    } catch {
      proc.off('exit', markExited);
      return;
    }
    setTimeout(() => {
      // The timer intentionally checks our exit flag rather than proc.killed.
      // proc.killed flips to true immediately after SIGTERM, which was the bug
      // that prevented stubborn ffmpeg processes from being force-killed.
      if (!exited) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // noop
        }
      }
    }, graceMs);
  }

  /*
    container selects the output muxer. mpegts is the historical path; rtsp avoids the
    server-side MPEG-TS cost measured at roughly 131ms on this leg. Everything before the
    output is identical, so switching cannot change what is encoded - only how it is carried.
  */
  function buildPublisherArgs(fifoPath, outputUrl, container = 'mpegts') {
    return [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-i',
      fifoPath,
      '-c:a',
      'libopus',
      '-b:a',
      '24000',
      '-ar:a',
      '16000',
      '-ac:a',
      '1',
      '-application',
      'lowdelay',
      '-frame_duration',
      '10',
      '-compression_level',
      '0',
      '-fflags',
      'nobuffer',
      '-flush_packets',
      '1',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      /*
        TCP for RTSP, not UDP. Measured over a real internet path, RTSP/UDP produced a stream
        MediaMTX reported as ready but that no WebRTC reader could ever start, because plain
        RTP/UDP has no retransmission and a fragmented keyframe never fully assembles. SRT has
        ARQ, so UDP here was strictly worse than what it replaced rather than equivalent.
      */
      ...(container === 'rtsp'
        ? ['-f', 'rtsp', '-rtsp_transport', 'tcp']
        : ['-f', 'mpegts']),
      outputUrl,
    ];
  }

  function buildSilenceWriterArgs() {
    return [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=mono:sample_rate=16000',
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      '16000',
      'pipe:1',
    ];
  }

  function buildFileWriterArgs(filePath) {
    return [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-re',
      '-i',
      filePath,
      '-vn',
      '-af',
      'aresample=16000',
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      '16000',
      'pipe:1',
    ];
  }

  function attachWriterPipe(worker, proc) {
    const writer = fs.createWriteStream(worker.fifoPath, { flags: 'w' });
    writer.on('error', (err) => {
      const code = err?.code || 'unknown';
      if (code !== 'EPIPE') {
        logger.warn('writer pipe error', { roverId: worker?.roverId, code, message: err?.message || String(err) });
      }
    });
    proc.stdout.on('error', (err) => {
      logger.warn('writer stdout error', {
        roverId: worker?.roverId,
        code: err?.code || 'unknown',
        message: err?.message || String(err),
      });
    });
    proc.stdout.pipe(writer);
    proc.on('exit', () => {
      writer.destroy();
    });
  }

  function cleanupUploadFile(worker) {
    if (!worker?.activeUploadPath) return;
    try {
      fs.unlinkSync(worker.activeUploadPath);
    } catch {
      // noop
    }
    worker.activeUploadPath = null;
  }

  function stopContentProc(worker) {
    if (!worker) return;
    if (worker.contentProc) {
      stopProc(worker.contentProc);
    }
    worker.contentProc = null;
    worker.contentKind = null;
  }

  function startSilenceWriter(roverId) {
    const worker = workers.get(roverId);
    if (!worker || worker.stopping) return;

    stopContentProc(worker);
    cleanupUploadFile(worker);
    worker.activeOwnerSocketId = null;
    const proc = spawnFfmpeg(roverId, 'silence-writer', buildSilenceWriterArgs(), { captureStdout: true });
    worker.contentProc = proc;
    worker.contentKind = 'silence';
    const seq = ++worker.writerSeq;
    attachWriterPipe(worker, proc);

    proc.on('exit', (code, signal) => {
      const current = workers.get(roverId);
      if (!current || current.stopping) return;
      if (current.writerSeq !== seq || current.contentProc !== proc) return;
      current.contentProc = null;
      current.contentKind = null;
      if (code === 0 || signal === 'SIGTERM') return;
      setState(roverId, {
        state: 'error',
        source: 'silence',
        error: `silence writer exited code=${code} signal=${signal || 'none'}`,
        startedAt: null,
      });
      setTimeout(() => {
        if (workers.has(roverId)) startSilenceWriter(roverId);
      }, 300);
    });

    setState(roverId, { state: 'idle', source: 'silence', error: null, startedAt: null });
  }

  function startFileWriter(roverId, filePath, options = {}) {
    const worker = workers.get(roverId);
    if (!worker || worker.stopping) return;

    const source = options.source || 'upload';
    const contentKind = options.contentKind || source;
    const ownerSocketId = options.ownerSocketId || null;
    const cleanupAfterPlayback = Boolean(options.cleanupAfterPlayback);

    stopContentProc(worker);
    cleanupUploadFile(worker);

    // Browser-uploaded files are temporary files that this service owns, so the
    // worker remembers them and deletes them when playback is interrupted or
    // replaced. Built-in server assets are deliberately not tracked here because
    // they are checked-in files shared across all rovers and must survive after
    // a single playback finishes.
    if (cleanupAfterPlayback) {
      worker.activeUploadPath = filePath;
    } else {
      worker.activeUploadPath = null;
    }

    // Socket ownership is meaningful only for user-started upload playback.
    // Server-started sounds such as the charging-complete cue pass no owner so
    // turn changes and browser disconnects do not treat the built-in sound as a
    // stale client session.
    worker.activeOwnerSocketId = ownerSocketId;
    const proc = spawnFfmpeg(roverId, `${source}-writer`, buildFileWriterArgs(filePath), { captureStdout: true });
    worker.contentProc = proc;
    worker.contentKind = contentKind;
    const seq = ++worker.writerSeq;
    attachWriterPipe(worker, proc);

    setState(roverId, { state: 'playing', source, error: null, startedAt: Date.now() });

    proc.on('exit', (code, signal) => {
      const current = workers.get(roverId);
      if (!current || current.stopping) return;
      if (current.writerSeq !== seq || current.contentProc !== proc) return;
      current.contentProc = null;
      current.contentKind = null;

      if (code != null && code !== 0 && signal !== 'SIGTERM') {
        setState(roverId, {
          state: 'error',
          source,
          error: `${source} writer exited code=${code} signal=${signal || 'none'}`,
          startedAt: null,
        });
      }
      startSilenceWriter(roverId);
    });
  }

  function ensureWorker(roverId) {
    if (!serviceEnabled) throw new Error('Audio forward disabled');
    if (!roverId) throw new Error('roverId required');

    const record = roverManager.rovers.get(roverId);
    if (!record || !record.ws) throw new Error('Rover offline');

    if (workers.has(roverId)) return workers.get(roverId);

    ensureRuntimeDir();
    const fifoPath = path.join(runtimeDir, `${sanitizeRoverId(roverId)}.pcm`);
    ensureFifo(fifoPath);
    const target = resolveForwardPublishTarget
      ? resolveForwardPublishTarget(roverId)
      : { url: resolveForwardUrl(roverId), container: 'mpegts' };
    const outputUrl = target.url;

    const keepaliveFd = fs.openSync(fifoPath, 'r+');
    const publisher = spawnFfmpeg(roverId, 'publisher', buildPublisherArgs(fifoPath, outputUrl, target.container));

    const worker = {
      roverId,
      fifoPath,
      keepaliveFd,
      outputUrl,
      publisherProc: publisher,
      contentProc: null,
      contentKind: null,
      writerSeq: 0,
      activeOwnerSocketId: null,
      activeUploadPath: null,
      stopping: false,
    };
    workers.set(roverId, worker);

    publisher.on('exit', (code, signal) => {
      const current = workers.get(roverId);
      if (!current || current.publisherProc !== publisher || current.stopping) return;
      setState(roverId, {
        state: 'error',
        source: current.contentKind || 'publish',
        error: `publisher exited code=${code} signal=${signal || 'none'}`,
        startedAt: null,
      });
    });

    startSilenceWriter(roverId);
    logger.info('Audio forward worker ready', { roverId, outputUrl, fifoPath });
    return worker;
  }

  function revokeWhipSessionForRover(roverId, ownerSocketId) {
    if (!roverId || !ownerSocketId) return;
    const pathId = resolveForwardPathId(roverId);
    videoSessions.revokeWhere(
      (info) => info?.socketId === ownerSocketId && info?.sourceType === 'roverMic' && info?.sourceId === pathId,
    );
  }

  function stopWorker(roverId) {
    const whipOwner = whipOwners.get(roverId);
    if (whipOwner) {
      whipOwners.delete(roverId);
      revokeWhipSessionForRover(roverId, whipOwner);
    }

    const worker = workers.get(roverId);
    if (!worker) return;

    worker.stopping = true;
    stopContentProc(worker);
    cleanupUploadFile(worker);
    stopProc(worker.publisherProc);

    try {
      fs.closeSync(worker.keepaliveFd);
    } catch {
      // noop
    }
    try {
      fs.unlinkSync(worker.fifoPath);
    } catch {
      // noop
    }

    workers.delete(roverId);
    setState(roverId, { state: 'offline', source: 'none', error: null, startedAt: null });
  }

  function stopAllWorkers(reason = 'shutdown') {
    // Copy the keys before stopping because stopWorker mutates the workers map.
    // Shutdown is a process-wide lifecycle event, so every rover-owned ffmpeg
    // process must be asked to exit before the parent Node process disappears.
    const roverIds = Array.from(workers.keys());
    if (roverIds.length) {
      logger.info('Stopping all audio forward workers', { reason, roverIds });
    }
    roverIds.forEach((roverId) => {
      stopWorker(roverId);
    });
  }

  function writeUploadFile(roverId, payload = {}) {
    const { name, mime, dataBase64 } = payload || {};
    const ext = extFromUpload(name, mime);
    const encoded = typeof dataBase64 === 'string' ? dataBase64.trim() : '';
    if (!encoded) throw new Error('Upload payload missing');

    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length) throw new Error('Upload decode failed');
    if (bytes.length > maxUploadBytes) throw new Error(`Upload too large (max ${maxUploadBytes} bytes)`);

    ensureRuntimeDir();
    const stem = sanitizeFileStem(name || `upload-${Date.now()}`);
    const filePath = path.join(uploadsDir, `${sanitizeRoverId(roverId)}-${Date.now()}-${stem}${ext}`);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  function stopWhipForRover(roverId, reason = 'unknown') {
    const ownerSocketId = whipOwners.get(roverId);
    if (!ownerSocketId) return;
    whipOwners.delete(roverId);
    revokeWhipSessionForRover(roverId, ownerSocketId);
    logger.info('Stopping WHIP mic session', { roverId, ownerSocketId, reason });
    try {
      ensureWorker(roverId);
      startSilenceWriter(roverId);
    } catch (err) {
      setState(roverId, {
        state: 'error',
        source: 'mic-whip',
        error: err?.message || String(err),
        startedAt: null,
      });
    }
  }

  function playUploadedAudio(roverId, payload = {}, ownerSocketId = null) {
    stopWhipForRover(roverId, 'upload_override');
    ensureWorker(roverId);
    const uploadPath = writeUploadFile(roverId, payload);
    startFileWriter(roverId, uploadPath, {
      source: 'upload',
      contentKind: 'upload',
      ownerSocketId,
      cleanupAfterPlayback: true,
    });
  }

  function playServerAudioFile(roverId, filePath, options = {}) {
    const source = options.source || 'server-file';
    const normalizedPath = path.resolve(filePath || '');
    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile()) {
      throw new Error(`Audio file is not a regular file: ${normalizedPath}`);
    }

    // Built-in sounds intentionally interrupt mic forwarding just like uploads
    // do. The rover can only publish one forwarded audio stream at a time, so
    // keeping WHIP alive would leave the automatic cue inaudible or mixed with
    // a stale publisher process.
    stopWhipForRover(roverId, `${source}_override`);
    ensureWorker(roverId);
    startFileWriter(roverId, normalizedPath, {
      source,
      contentKind: source,
      ownerSocketId: null,
      cleanupAfterPlayback: false,
    });
  }

  function stopPlayback(roverId) {
    stopWhipForRover(roverId, 'stop_playback');
    ensureWorker(roverId);
    startSilenceWriter(roverId);
  }

  function stopOwnedAudioIfUnauthorized(roverId, ownerSocketId, reason = 'driver_change') {
    if (!roverId || !ownerSocketId) return;

    if (whipOwners.get(roverId) === ownerSocketId) {
      const ownerSocket = io.sockets.sockets.get(ownerSocketId);
      const ownerIsDriver = ownerSocket ? roverManager.isDriver(roverId, ownerSocket) : false;
      const ownerCanDrive = ownerSocket ? turnService.canDrive(roverId, ownerSocket) : false;
      if (!ownerIsDriver || !ownerCanDrive) {
        stopWhipForRover(roverId, reason);
      }
    }

    const worker = workers.get(roverId);
    if (!worker || worker.contentKind !== 'upload' || worker.activeOwnerSocketId !== ownerSocketId) return;

    const ownerSocket = io.sockets.sockets.get(ownerSocketId);
    const ownerIsDriver = ownerSocket ? roverManager.isDriver(roverId, ownerSocket) : false;
    const ownerCanDrive = ownerSocket ? turnService.canDrive(roverId, ownerSocket) : false;
    if (ownerIsDriver && ownerCanDrive) return;

    logger.info('Stopping upload audio due to ownership/driver change', { roverId, ownerSocketId, reason });
    startSilenceWriter(roverId);
  }

  return {
    ensureWorker,
    stopWorker,
    stopAllWorkers,
    playUploadedAudio,
    playServerAudioFile,
    stopPlayback,
    revokeWhipSessionForRover,
    stopWhipForRover,
    stopOwnedAudioIfUnauthorized,
    startSilenceWriter,
  };
}

module.exports = {
  createAudioForwardWorkerEngine,
};
