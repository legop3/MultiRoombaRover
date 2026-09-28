// Complete card snapshots; live diagnostics opt into 10 Hz, ordinary cards use 1 Hz.
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { isVerified } = require('../verificationService');
const { listModels } = require('./models');
const { report } = require('./diagnostics');
const { compatible } = require('./capabilities');

function createGateway({ root, driving, getSystemState, activity }) {
  const bindings = new Map();
  const viewers = new Map();
  let models = [];
  let modelError = null;
  let lastCatalog = 0;
  let closed = false;
  let refreshing = false;
  let lastOrdinary = 0;

  function stateFor(socket, roverId) {
    if (!isVerified(socket)) return { available: false };
    const visible = roverId && roverManager.canSeeRover(roverId, socket);
    const id = visible ? roverId : null;
    const session = id ? driving.getState(id) : null;
    const canControl = Boolean(id && driving.canControl(socket, id));
    const system = getSystemState();
    const state = {
      available: true, roverId: id, updatedAt: Date.now(),
      control: { canStart: canControl && !session, canAdjust: canControl && Boolean(session), canStop: Boolean(session && (canControl || session.socketId === socket.id)),
        reason: !id ? 'Select a rover first' : !canControl ? 'You do not currently have control of this rover' : null },
      session,
      models: models.filter((model) => model.trainedRovers?.some((rover) => roverManager.canSeeRover(rover, socket)))
        .map((model) => ({ id: model.id, name: model.name, createdAt: model.createdAt,
          trainingSteps: model.trainingSteps, examplesProcessed: model.examplesProcessed,
          weightBytes: model.weightBytes, parameters: model.parameters, trainingLoss: model.trainingLoss,
          formatVersion: model.specification?.version, evaluation: model.evaluation, validation: model.validation, distinctMinutes: model.distinctMinutes, controls: model.specification?.commands?.length || 0,
          compatible: Boolean(id && compatible(model, roverManager.rovers.get(id))) })),
      catalogError: modelError,
      recording: { ...system.recording, sessions: system.recording.sessions.filter((s) => roverManager.canSeeRover(s.roverId, socket)) },
      training: { ...system.training, sessions: undefined },
      limits: system.limits,
      activity: system.activity.filter((entry) => !entry.roverId || roverManager.canSeeRover(entry.roverId, socket)),
    };
    state.diagnostics = viewers.get(socket)?.live ? report(state, id ? driving.getDiagnostics(id) : null) : null;
    return state;
  }

  async function refresh() {
    if (closed || refreshing) return;
    refreshing = true;
    try {
      if (Date.now() - lastCatalog >= 15000) {
        lastCatalog = Date.now();
        try { models = await listModels(root); modelError = null; }
        catch (error) { modelError = error.message; }
      }
      if (closed) return;
      const ordinary = Date.now() - lastOrdinary >= 1000;
      if (ordinary) lastOrdinary = Date.now();
      for (const [socket, view] of viewers) {
        if (ordinary || view.live || driving.isActive(view.roverId)) socket.volatile.emit('roverLearning:state', stateFor(socket, view.roverId));
      }
    } finally { refreshing = false; }
  }

  function connect(socket) {
    const subscribe = (payload = {}, reply) => {
      const respond = typeof reply === 'function' ? reply : () => {};
      if (!isVerified(socket)) { respond({ error: 'Verification required' }); return; }
      const roverId = typeof payload?.roverId === 'string' ? payload.roverId : null;
      viewers.set(socket, { roverId, live: payload.live === true });
      respond({ state: stateFor(socket, roverId) });
      refresh().catch((error) => activity('Card update failed', { error: error.message }));
    };
    const action = async (payload = {}, reply) => {
      const respond = typeof reply === 'function' ? reply : () => {};
      try {
        if (!isVerified(socket)) throw new Error('Verification required');
        const roverId = String(payload.roverId || '');
        if (payload.action === 'start') await driving.start(socket, roverId, String(payload.modelId || ''));
        else if (payload.action === 'threshold') driving.setThreshold(socket, roverId, payload.value);
        else if (payload.action === 'stop') {
          const session = driving.getState(roverId);
          if (!session || !(driving.canControl(socket, roverId) || session.socketId === socket.id)) throw new Error('You cannot stop this controller');
          await driving.stop(roverId);
        } else throw new Error('Unknown action');
        viewers.set(socket, { roverId, live: viewers.get(socket)?.live || false });
        respond({ state: stateFor(socket, roverId) });
      } catch (error) { respond({ error: error.message }); }
      refresh().catch((error) => activity('Card update failed', { error: error.message }));
    };
    const unsubscribe = () => viewers.delete(socket);
    const disconnect = () => { unsubscribe(); detach(socket); };
    const handlers = { 'roverLearning:subscribe': subscribe, 'roverLearning:action': action,
      'roverLearning:unsubscribe': unsubscribe, disconnect };
    for (const [name, handler] of Object.entries(handlers)) socket.on(name, handler);
    bindings.set(socket, handlers);
  }

  function detach(socket) {
    for (const [name, handler] of Object.entries(bindings.get(socket) || {})) socket.off(name, handler);
    bindings.delete(socket);
  }

  io.on('connection', connect);
  for (const socket of io.sockets.sockets.values()) connect(socket);
  const timer = setInterval(() => { refresh().catch((error) => activity('Card update failed', { error: error.message })); }, 100);
  refresh().catch((error) => activity('Catalog unavailable', { error: error.message }));
  return {
    close() {
      closed = true;
      clearInterval(timer);
      io.off('connection', connect);
      for (const socket of viewers.keys()) socket.emit('roverLearning:state', { available: false });
      viewers.clear();
      for (const socket of bindings.keys()) detach(socket);
    },
  };
}

module.exports = { createGateway };
