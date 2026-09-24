// Socket transport delegates policy and lifecycle decisions to the PTZ service.
function registerSocketGateway(deps) {
  const { io, isAdmin, participation, emitChange, normalizeSocketArgs,
    runPtzTurnAction, acceptMotionIntent, getStatus, setSpotlight, setIr,
    listPresets, gotoPreset, createPreset, removePreset, passesMode,
    normalizeSnapshotIds, addSnapshotSubscription, sendSnapshotFrame,
    getSnapshot, removeSnapshotSubscriptions } = deps;
  io.on('connection', (socket) => {
    socket.on('ptzCamera:revokeOperator', (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      if (!isAdmin(socket)) return cb({ error: 'Admin required' });
      participation.revoke('admin-revoke');
      cb({ ok: true });
    });
    socket.on('ptzCamera:requestTurn', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try { cb({ ok: true, state: await runPtzTurnAction(socket, 'request') }); }
      catch (err) { cb({ error: err.message }); }
    });
    socket.on('ptzCamera:release', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, state: await runPtzTurnAction(socket, 'release') });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:motion', (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        /*
          Acknowledge acceptance of the newest desired state immediately. The
          serialized ONVIF pump deliberately runs independently of Socket.IO
          request latency so browser heartbeats cannot accumulate while waiting
          for a camera SOAP response.
        */
        cb(acceptMotionIntent(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:status', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, status: await getStatus(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:spotlight', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, light: await setSpotlight(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:ir', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, ir: await setIr(socket, payload) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:presets:list', async (firstArg, secondArg) => {
      const { cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb({ ok: true, presets: await listPresets(socket) });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:goto', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await gotoPreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:create', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await createPreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:preset:remove', async (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        cb(await removePreset(socket, payload));
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotSubscribe', (firstArg, secondArg) => {
      const { payload, cb } = normalizeSocketArgs(firstArg, secondArg);
      try {
        if (!passesMode(socket)) throw new Error('Not authorized for PTZ snapshots');
        const ids = normalizeSnapshotIds(payload);
        addSnapshotSubscription(socket, ids);
        const lastSnapshotState = getSnapshot();
        if (lastSnapshotState?.frame) sendSnapshotFrame(socket, lastSnapshotState.frame, lastSnapshotState.ts);
        cb({ ok: true, subscribed: ids });
      } catch (err) {
        cb({ error: err.message });
      }
    });
    socket.on('ptzCamera:snapshotUnsubscribe', (firstArg, secondArg) => {
      const { payload } = normalizeSocketArgs(firstArg, secondArg);
      removeSnapshotSubscriptions(socket.id, normalizeSnapshotIds(payload));
    });
    socket.on('disconnect', () => {
      participation.release(socket.id, 'disconnect');
      removeSnapshotSubscriptions(socket.id);
      emitChange('disconnect');
    });
  });
}

module.exports = { registerSocketGateway };
