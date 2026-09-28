// Enabled-only recording, training, controller, and card lifecycle.
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveDataPath } = require('../../helpers/dataPaths');
const roverManager = require('../roverManager');
const io = require('../../globals/io');
const { turnEvents } = require('../turnService');
const { modeEvents } = require('../modeManager');
const { isAdmin, roleEvents } = require('../roleService');
const { isDeterred, verificationEvents } = require('../verificationService');
const { subscribeCommandRecording, commandEvents } = require('../commandService');
const { createRecording } = require('./recording');
const { recoverRecordings, enforceRetention } = require('./storage');
const { createTrainer } = require('./training');
const { createDriving } = require('./driving');
const { createGateway } = require('./socketGateway');

function createRuntime({ config, logger }) {
  const root = resolveDataPath('rover-learning');
  const recordingsRoot = path.join(root, 'recordings');
  const recentActivity = [];
  function activity(message, details = {}) {
    recentActivity.push({ at: Date.now(), message, roverId: details.roverId || null,
      detail: details.reason || details.error || details.model || null });
    if (recentActivity.length > 40) recentActivity.shift();
  }
  const baseLogger = logger;
  logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (message, details) => {
    baseLogger[level](message, details); activity(message, details);
  }]));
  const trainer = createTrainer({ root, config: config.training, logger });
  const driving = createDriving({ root, config, onChange: refreshEligibility, activity });
  let gateway;
  let diskState = { bytes: null, free: null };
  const sessions = new Map();
  const unsubscribers = [];
  let running = false;
  let timer;
  let maintenance = Promise.resolve();
  let stopPromise;
  let diskPaused = false;
  let busy = false;
  let wakeRequested = false;
  let pending = [];
  let pendingBytes = 0;
  let droppedPending = 0;
  let eligibleRovers = new Set();

  function hasHumanController(roverId) {
    // Even manual inputs during autonomy remain excluded: model-influenced
    // video must not silently become human demonstration training data.
    if (driving.isActive(roverId)) return false;
    const record = roverManager.rovers.get(roverId);
    if (!record?.ws) return false;
    // Admin permission alone must not record the whole fleet. Require actual
    // driver membership, a live browser socket, and current control eligibility.
    for (const socketId of record.drivers || []) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket?.connected && (isAdmin(socket) || !isDeterred(socket))
          && roverManager.canDrive(roverId, socket)) return true;
    }
    return false;
  }

  function currentEligibleRovers() {
    return new Set([...roverManager.rovers.keys()].filter(hasHumanController));
  }

  function refreshEligibility() {
    const next = currentEligibleRovers();
    const changed = next.size !== eligibleRovers.size || [...next].some((id) => !eligibleRovers.has(id));
    eligibleRovers = next;
    if (!changed) return;
    // Stop the stream immediately even if disk maintenance is in progress.
    // The serialized maintenance pass still owns closing/removing the session.
    for (const [id, session] of sessions) {
      if (!next.has(id)) session.stop('no-human-controller').catch((error) => {
        logger.warn('Unable to finalize unattended recording', { roverId: id, error: error.message });
      });
    }
    schedule();
  }

  function append(kind, event) {
    if (!running || event?.roverId == null) return;
    const roverId = String(event.roverId);
    if (!hasHumanController(roverId)) return;
    const timestamp = { ts: Date.now(), monotonicNs: process.hrtime.bigint().toString() };
    if (sessions.get(roverId)?.append(kind, event, timestamp)) return;
    if (diskPaused || !roverManager.rovers.has(roverId)) return;
    // Session creation/rotation is asynchronous. Keep a bounded snapshot of
    // events arriving during that gap, with their original observation times.
    try {
      const serialized = JSON.stringify(event);
      const bytes = Buffer.byteLength(serialized);
      if (pendingBytes + bytes > 4 * 1024 * 1024) {
        droppedPending += 1;
        return;
      }
      pending.push({ roverId, kind, serialized, timestamp, bytes });
      pendingBytes += bytes;
    } catch { droppedPending += 1; }
  }

  function listen(emitter, name, handler) {
    emitter.on(name, handler);
    unsubscribers.push(() => emitter.off(name, handler));
  }

  function snapshot(record) {
    // Do not serialize the live record: it contains sockets and circular state.
    return {
      meta: record.meta, sensors: record.lastSensor, hostStats: record.lastHostStats,
      batteryState: record.batteryState, headlightState: record.headlightState,
      laserState: record.laserState, drivers: [...(record.drivers || [])],
      locked: record.locked, privateOpen: record.privateOpen,
    };
  }

  async function closeSession(roverId, reason) {
    const session = sessions.get(roverId);
    if (!session) return;
    try {
      await session.stop(reason);
    } finally {
      // Keep closing children reachable by the synchronous process-exit hook.
      sessions.delete(roverId);
    }
  }

  async function maintain() {
    if (!running) return;
    pending = pending.filter((event) => hasHumanController(event.roverId));
    pendingBytes = pending.reduce((sum, event) => sum + event.bytes, 0);
    for (const [roverId, session] of sessions) {
      const record = roverManager.rovers.get(roverId);
      if (!hasHumanController(roverId) || session.stopping || session.failed || Date.now() - session.startedAt >= config.recording.sessionSeconds * 1000) {
        await closeSession(roverId, !record?.ws ? 'offline' : !hasHumanController(roverId) ? 'no-human-controller' : session.failed ? 'recorder-failed' : 'rotation');
      }
    }
    if (!running) return;
    const retention = await enforceRetention(
      recordingsRoot, new Set([...sessions.values()].map((session) => session.id).concat([...trainer.leases])),
      config.recording.maxGiB * 1024 ** 3, config.recording.minimumFreeGiB * 1024 ** 3,
    );
    diskState = retention;
    if (retention.paused) {
      if (!diskPaused) logger.warn('Recording paused for disk budget', retention);
      diskPaused = true;
      pending = [];
      pendingBytes = 0;
      await trainer.cancel();
      // Close active files to make them eligible for pruning on the next tick.
      await Promise.all([...sessions.keys()].map((id) => closeSession(id, 'disk-budget')));
      return;
    }
    if (diskPaused) logger.info('Recording resumed after disk budget recovery');
    diskPaused = false;
    for (const [key, record] of roverManager.rovers) {
      if (!running) break;
      const roverId = String(key);
      if (!hasHumanController(roverId) || sessions.has(roverId)) continue;
      const session = await createRecording({ root: recordingsRoot, roverId, snapshot: snapshot(record), logger });
      sessions.set(roverId, session);
      // Filesystem awaits can span a disconnect or turn change.
      if (!running || !hasHumanController(roverId)) {
        await closeSession(roverId, running ? 'no-human-controller' : 'disabled');
        continue;
      }
      if (droppedPending) {
        session.append('captureGap', { droppedEventsAcrossRovers: droppedPending });
        droppedPending = 0;
      }
      pending = pending.filter((event) => {
        if (event.roverId !== roverId) return true;
        session.append(event.kind, JSON.parse(event.serialized), event.timestamp);
        pendingBytes -= event.bytes;
        return false;
      });
    }
    if (running) {
      try {
        await trainer.tick(new Set([...sessions.values()].map((session) => session.id)));
      } catch (error) {
        // Training availability must not tear down otherwise healthy capture.
        logger.error('Unable to schedule training', { error: error.message });
      }
    }
  }

  function schedule() {
    if (!running) return;
    if (busy) { wakeRequested = true; return; }
    clearTimeout(timer);
    busy = true;
    // The next tick is scheduled after completion: disk slowness cannot build
    // an unbounded backlog of retention tasks or overlapping recorder starts.
    maintenance = maintain().catch(async (error) => {
      logger.error('Recording maintenance failed; closing recorders', { error: error.message });
      await Promise.allSettled([...sessions.keys()].map((id) => closeSession(id, 'storage-error')));
    }).finally(() => {
      busy = false;
      if (running) timer = setTimeout(schedule, wakeRequested ? 0 : 15000);
      wakeRequested = false;
    });
  }

  function killChildren() {
    driving.kill();
    trainer.kill();
    for (const session of sessions.values()) session.kill();
  }
  function onSignal() {
    // Other server services can exit the process before asynchronous cleanup
    // finishes. Signal children immediately, and keep an exit fallback too.
    for (const session of sessions.values()) session.stop('server-shutdown').catch(() => undefined);
    stop().catch((error) => logger.warn('Recording shutdown failed', { error: error.message }));
  }

  async function start() {
    await fs.mkdir(recordingsRoot, { recursive: true });
    await recoverRecordings(recordingsRoot);
    await trainer.start();
    running = true;
    driving.attach();
    gateway = createGateway({ root, driving, activity, getSystemState: () => ({
      recording: { paused: diskPaused, bytes: diskState.bytes, freeBytes: diskState.free,
        pendingBytes, droppedPending, sessions: [...sessions.values()].map((session) => session.getStatus()) },
      training: trainer.getState(),
      limits: { recording: config.recording, training: { ...config.training, python: undefined }, driving: config.driving },
      activity: [...recentActivity].reverse(),
    }) });
    eligibleRovers = currentEligibleRovers();
    unsubscribers.push(subscribeCommandRecording((event) => append('command', event)));
    // ACK analytics also provide latency/type context; detailed acknowledgements
    // arrive through the recording hook and share the command ID.
    listen(commandEvents, 'observation', (event) => append('commandOutcome', event));
    listen(roverManager.managerEvents, 'sensor', (event) => append('sensor', {
      ...event,
      // The manager stores the exact frame before emitting this synchronous
      // event, so raw capture needs no extra hook in rover sensor processing.
      frame: roverManager.rovers.get(event.roverId)?.lastSensor?.raw,
    }));
    for (const kind of ['hostStats', 'driver', 'switch', 'lock', 'private', 'privateSafety', 'help', 'dockGuard']) {
      listen(roverManager.managerEvents, kind, (event) => {
        append(kind, event);
        if (['driver', 'switch', 'lock', 'private', 'privateSafety'].includes(kind)) refreshEligibility();
      });
    }
    for (const kind of ['activeDriver', 'queue']) {
      listen(turnEvents, kind, (event) => { append(`turn:${kind}`, event); refreshEligibility(); });
    }
    listen(modeEvents, 'change', refreshEligibility);
    listen(roleEvents, 'change', refreshEligibility);
    listen(verificationEvents, 'change', refreshEligibility);
    listen(roverManager.managerEvents, 'rover', (event) => {
      append('rover', { roverId: event.roverId, action: event.action, snapshot: event.record ? snapshot(event.record) : null });
      if (event.action === 'upsert' || event.action === 'removed') refreshEligibility();
    });
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    process.on('exit', killChildren);
    busy = true;
    maintenance = maintain();
    try {
      await maintenance;
    } finally {
      busy = false;
    }
    if (running) timer = setTimeout(schedule, wakeRequested ? 0 : 15000);
    wakeRequested = false;
    logger.info('Rover learning enabled', { root, training: config.training.enabled });
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    running = false;
    gateway?.close();
    clearTimeout(timer);
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    stopPromise = (async () => {
      const trainingStop = trainer.stop();
      const drivingStop = driving.shutdown();
      await maintenance.catch(() => undefined);
      const results = await Promise.allSettled([...sessions.keys()].map((id) => closeSession(id, 'disabled')));
      await trainingStop;
      await drivingStop;
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      process.off('exit', killChildren);
      pending = [];
      pendingBytes = 0;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    })();
    return stopPromise;
  }

  return { start, stop, getTrainingState: trainer.getState };
}

module.exports = { createRuntime };
