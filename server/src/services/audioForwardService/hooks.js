// audio Forward Service hooks
// Purpose: Registers rover/turn lifecycle listeners and socket handlers for audio forwarding controls.
// Scope: Keeps runtime behavior unchanged by delegating to injected core operations.
function registerAudioForwardHooks(deps) {
  const {
    io,
    roverManager,
    turnService,
    logger,
    serviceEnabled,
    workers,
    whipOwners,
    ensureWorker,
    stopWorker,
    setState,
    stopOwnedAudioIfUnauthorized,
    stopWhipForRover,
    ensureAudioForwardPermission,
    playUploadedAudio,
    stopPlayback,
    resolveForwardPathId,
    revokeWhipSessionForRover,
    buildWhipUrl,
    videoSessions,
    startSilenceWriter,
  } = deps;

  roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
    if (!roverId) return;
    if (action === 'removed') {
      stopWorker(roverId);
      return;
    }
    if (action === 'upsert' && serviceEnabled && !workers.has(roverId)) {
      // A rover coming online should not create ffmpeg publishers by itself.
      // The audio worker is intentionally lazy because uploads, mic forwarding,
      // and automatic sounds are the moments that actually need a media pipe;
      // keeping idle ffmpeg children around made restarts depend on processes
      // that may never have been used by an operator.
      setState(roverId, { state: 'offline', source: 'none', error: null, startedAt: null });
    }
  });

  roverManager.managerEvents.on('driver', ({ socketId, roverId, action } = {}) => {
    if (!socketId || !roverId) return;
    if (action === 'remove' || action === 'add') {
      stopOwnedAudioIfUnauthorized(roverId, socketId, action);
    }
  });

  turnService.turnEvents.on('activeDriver', ({ roverId } = {}) => {
    if (!roverId) return;
    const whipOwner = whipOwners.get(roverId);
    if (whipOwner) {
      stopOwnedAudioIfUnauthorized(roverId, whipOwner, 'turn_change');
    }
    const worker = workers.get(roverId);
    if (!worker || worker.contentKind !== 'upload') return;
    stopOwnedAudioIfUnauthorized(roverId, worker.activeOwnerSocketId, 'turn_change');
  });

  io.on('connection', (socket) => {
    socket.on('audio:uploadPlay', (payload = {}, cb = () => {}) => {
      try {
        const roverId = String(payload?.roverId || '').trim();
        ensureAudioForwardPermission(socket, roverId);
        playUploadedAudio(roverId, payload, socket.id);
        cb({ success: true, roverId });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('audio:uploadStop', ({ roverId } = {}, cb = () => {}) => {
      try {
        const normalized = String(roverId || '').trim();
        ensureAudioForwardPermission(socket, normalized);
        const worker = workers.get(normalized);
        if (worker && worker.contentKind === 'upload' && worker.activeOwnerSocketId !== socket.id) {
          throw new Error('Upload playback is owned by another session');
        }
        stopPlayback(normalized);
        cb({ success: true, roverId: normalized });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('audio:micWhipStart', ({ roverId } = {}, cb = () => {}) => {
      try {
        const normalized = String(roverId || '').trim();
        ensureAudioForwardPermission(socket, normalized);
        stopWorker(normalized);
        whipOwners.set(normalized, socket.id);
        const pathId = resolveForwardPathId(normalized);
        revokeWhipSessionForRover(normalized, socket.id);
        const token = videoSessions.createSession(socket, { type: 'roverMic', id: pathId });
        const whipUrl = buildWhipUrl(pathId);
        setState(normalized, { state: 'starting', source: 'mic-whip', error: null, startedAt: Date.now() });
        cb({ success: true, roverId: normalized, pathId, token, whipUrl });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('audio:micWhipReady', ({ roverId } = {}, cb = () => {}) => {
      try {
        const normalized = String(roverId || '').trim();
        ensureAudioForwardPermission(socket, normalized);
        if (whipOwners.get(normalized) !== socket.id) {
          throw new Error('WHIP session not owned by this client');
        }
        setState(normalized, { state: 'playing', source: 'mic-whip', error: null, startedAt: Date.now() });
        cb({ success: true, roverId: normalized });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('audio:micWhipStop', ({ roverId } = {}, cb = () => {}) => {
      try {
        const normalized = String(roverId || '').trim();
        ensureAudioForwardPermission(socket, normalized);
        if (whipOwners.get(normalized) && whipOwners.get(normalized) !== socket.id) {
          throw new Error('Mic forwarding is owned by another session');
        }
        stopWhipForRover(normalized, 'client_stop');
        cb({ success: true, roverId: normalized });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      workers.forEach((worker, roverId) => {
        if (!worker || worker.contentKind !== 'upload' || worker.activeOwnerSocketId !== socket.id) return;
        logger.info('Stopping owned upload audio due to socket disconnect', { roverId, socketId: socket.id });
        startSilenceWriter(roverId);
      });
      for (const [roverId, ownerSocketId] of whipOwners.entries()) {
        if (ownerSocketId !== socket.id) continue;
        stopWhipForRover(roverId, 'socket_disconnect');
      }
    });
  });
}

module.exports = {
  registerAudioForwardHooks,
};
