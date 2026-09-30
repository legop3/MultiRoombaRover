// Autonomy owns a live user's control context, never an administrative identity.
const path = require('node:path');
const { spawn } = require('node:child_process');
const roverManager = require('../roverManager');
const { isVerified, isDeterred } = require('../verificationService');
const { isAdmin } = require('../roleService');
const { submitCommand, issueCommand, subscribeCommandRecording } = require('../commandService');
const { recordCommandRequest } = require('../commandService/recording');
const { acquireModel } = require('./models');
const { compatible } = require('./capabilities');

const OPERATING = new Set(['drive', 'motors', 'servo', 'headlight', 'laser', 'horn', 'song', 'raw']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function canControl(socket, roverId) {
  return Boolean(socket?.connected && isVerified(socket) && (isAdmin(socket) || !isDeterred(socket))
    && roverManager.rovers.get(roverId)?.ws && roverManager.canDrive(roverId, socket));
}

function createDriving({ root, config, onChange, activity }) {
  const sessions = new Map();
  const recent = new Map();
  let stopping = false;
  let watchdog;
  let unsubscribe;

  function sendState(session, event) {
    const input = session.worker.stdin;
    if (input.destroyed || !input.writable || input.writableLength > 256 * 1024) return;
    input.write(JSON.stringify(event) + '\n');
  }

  function transmit(session, command) {
    if (session.status === 'stopping') return;
    if (!canControl(session.socket, session.roverId)) { stop(session.roverId, 'Control permission lost'); return; }
    if (!OPERATING.has(command?.type)) throw new Error('Unsupported model command');
    const record = roverManager.rovers.get(session.roverId);
    if (command.type === 'drive') {
      const limit = Math.min(500, Number(record.meta?.maxWheelSpeed) || 500);
      command.driveDirect = { left: Math.round(clamp(command.driveDirect?.left, -limit, limit)), right: Math.round(clamp(command.driveDirect?.right, -limit, limit)) };
    }
    if (command.type === 'motors') {
      command.motorPwm = { main: clamp(command.motorPwm?.main, -127, 127), side: clamp(command.motorPwm?.side, -127, 127), vacuum: clamp(command.motorPwm?.vacuum, 0, 127) };
    }
    if (command.type === 'servo') {
      const servo = record.meta?.cameraServo;
      if (!servo?.enabled) { session.submissions.push({ command, result: 'Servo unavailable' }); return; }
      command.servo.angle = clamp(command.servo?.angle, servo.minAngle ?? 0, servo.maxAngle ?? 180);
    }
    const { type, ...data } = command;
    recordCommandRequest(session.socket, { roverId: session.roverId, type, data }, (result) => {
      session.lastResult = result.error || result.reason || 'issued';
      session.submissions.push({ command, result: session.lastResult });
      if (result.id) session.lastAction = { at: Date.now(), command };
    }, (request, reply) => submitCommand(session.socket, request, reply), 'model');
  }

  function stop(roverId, reason = 'Stopped by user') {
    const session = sessions.get(roverId);
    if (!session) return Promise.resolve();
    if (session.done) return session.done;
    session.status = 'stopping';
    session.stopReason = reason;
    // A stop must still reach the rover after turn permission is revoked.
    for (const command of [
      { type: 'drive', driveDirect: { left: 0, right: 0 } },
      { type: 'motors', motorPwm: { main: 0, side: 0, vacuum: 0 } },
      { type: 'horn', horn: { action: 'stop' } },
    ]) { try { issueCommand(roverId, command); } catch { /* Rover may already be offline. */ } }
    session.worker.kill('SIGTERM');
    const timer = setTimeout(() => session.worker.kill('SIGKILL'), 2000);
    session.done = session.closed.then(() => {
      clearTimeout(timer);
      recent.delete(roverId);
      recent.set(roverId, { modelId: session.modelId, stopReason: reason, history: session.history });
      if (recent.size > 20) recent.delete(recent.keys().next().value);
      sessions.delete(roverId);
      activity('Controller stopped', { roverId, reason });
      onChange();
    });
    onChange();
    return session.done;
  }

  async function start(socket, roverId, modelId) {
    if (stopping || !canControl(socket, roverId)) throw new Error('You cannot control this rover');
    const acquired = await acquireModel(root, modelId);
    const { directory, metadata } = acquired;
    try {
      if (!compatible(metadata, roverManager.rovers.get(roverId))) throw new Error('Model is not compatible with this rover');
      if (stopping || !canControl(socket, roverId)) throw new Error('Control permission changed');
      if (sessions.has(roverId)) throw new Error('Stop the current controller before starting another model');
    } catch (error) { await acquired.release(); throw error; }
    const worker = spawn(config.training.python, [path.join(__dirname, 'workers/infer.py'), '--model', directory,
      '--url', `rtsp://127.0.0.1:8554/${encodeURIComponent(roverId)}`, '--threads', String(config.driving.threads),
      '--threshold', String(config.driving.actionThreshold)], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const session = { worker, socket, roverId, modelId, checkpointId: metadata.id, modelName: modelId === 'latest' ? 'Latest' : modelId === 'previous' ? 'Previous' : metadata.name, status: 'starting', startedAt: Date.now(), lastPredictionAt: null, threshold: config.driving.actionThreshold, history: [] };
    session.closed = new Promise((resolve) => worker.once('close', resolve));
    session.closed.then(() => acquired.release()).catch((error) => activity('Checkpoint release failed', { error: error.message }));
    sessions.set(roverId, session);
    recent.delete(roverId);
    let output = '';
    let stderr = '';
    worker.stdin.on('error', () => { stop(roverId, 'Worker input closed'); });
    worker.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1000); });
    worker.on('error', (error) => { stop(roverId, error.message); });
    worker.once('close', () => { stop(roverId, stderr || 'Worker exited'); });
    worker.stdout.on('data', (chunk) => {
      if (session.status === 'stopping') return;
      output += chunk;
      if (output.length > 1024 * 1024) { stop(roverId, 'Worker output exceeded limit'); return; }
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.kind === 'error') throw new Error(message.message);
          if (message.kind !== 'prediction') continue;
          if (!Number.isFinite(message.frameAt) || Math.abs(Date.now() - message.frameAt) > config.driving.staleMs) throw new Error('Video is stale');
          if (!Number.isFinite(message.sensorAt) || Math.abs(Date.now() - message.sensorAt) > config.driving.staleMs) throw new Error('Sensors are stale');
          if (!canControl(socket, roverId)) throw new Error('Control permission lost');
          session.status = 'running';
          session.lastPredictionAt = Date.now();
          session.frameAt = message.frameAt;
          session.sensorAt = message.sensorAt;
          session.latencyMs = message.latencyMs;
          session.proposals = Array.isArray(message.proposals) ? message.proposals.slice(0, 64) : [];
          session.appliedThreshold = message.threshold;
          session.sensorPresent = message.sensorPresent;
          session.submissions = [];
          if (!Array.isArray(message.commands) || message.commands.length > 65) throw new Error('Invalid action batch');
          session.predictionStatus = message.commands.length ? `${message.commands.length} command(s) proposed` : 'No command proposed';
          // Manual commands intentionally do not stop or pause this controller.
          for (const command of message.commands) transmit(session, command);
          // Bound report history independently of camera and UI frame rates.
          if (!session.history.length || Date.now() - session.history.at(-1).at >= 500) {
            session.history.push({ at: Date.now(),
              latencyMs: session.latencyMs, frameAgeMs: Date.now() - session.frameAt,
              sensorAgeMs: Date.now() - session.sensorAt, threshold: session.appliedThreshold,
              proposals: [...session.proposals].sort((a, b) => b.score - a.score).slice(0, 8).map(({ slot, score, reason, command }) => ({ slot, score, reason, command })),
              submissions: session.submissions.slice(0, 16).map(({ command, result }) => ({ type: command.type, result, command })) });
            if (session.history.length > 60) session.history.shift();
          }
        } catch (error) { stop(roverId, error.message); break; }
      }
    });
    const sensors = roverManager.rovers.get(roverId)?.lastSensor?.decoded;
    if (sensors) sendState(session, { kind: 'sensor', ts: Date.now(), data: sensors });
    activity('Controller started', { roverId, model: metadata.name, socketId: socket.id });
    onChange();
  }

  function sensor(event) {
    const session = sessions.get(String(event.roverId));
    if (session) sendState(session, { kind: 'sensor', ts: Date.now(), data: event.sensors });
  }

  function attach() {
    roverManager.managerEvents.on('sensor', sensor);
    unsubscribe = subscribeCommandRecording((event) => {
      const session = sessions.get(String(event.roverId));
      if (session && event.phase === 'dispatched') sendState(session, { kind: 'command', ts: event.ts, data: event.command });
    });
    watchdog = setInterval(() => {
      for (const session of sessions.values()) {
        if (!canControl(session.socket, session.roverId)) stop(session.roverId, 'Control permission lost');
        else if (Date.now() - (session.lastPredictionAt || session.startedAt) > (session.lastPredictionAt ? config.driving.staleMs : 30000)) {
          stop(session.roverId, 'No fresh model predictions');
        }
      }
    }, 250);
  }

  return {
    attach, start, stop, canControl,
    setThreshold(socket, roverId, value) {
      const session = sessions.get(roverId);
      if (!session || session.status === 'stopping' || !canControl(socket, roverId)) throw new Error('You cannot adjust this controller');
      if (typeof value !== 'number' || !Number.isFinite(value) || value < .05 || value > .99) throw new Error('Threshold must be between 0.05 and 0.99');
      session.threshold = value;
      sendState(session, { kind: 'settings', ts: Date.now(), threshold: value });
    },
    getDiagnostics(id) {
      const session = sessions.get(id);
      return session ? { modelId: session.modelId, sensorPresent: session.sensorPresent, history: session.history } : recent.get(id) || null;
    },
    isActive: (id) => sessions.has(id),
    getState: (id) => {
      const session = sessions.get(id);
      if (!session) return null;
      const { worker, socket, closed, done, history, ...state } = session;
      return { ...state, startedBy: socket.data?.nickname || socket.id, socketId: socket.id };
    },
    shutdown: async () => {
      stopping = true;
      clearInterval(watchdog);
      unsubscribe?.();
      roverManager.managerEvents.off('sensor', sensor);
      await Promise.all([...sessions.keys()].map((id) => stop(id, 'Service disabled')));
    },
    kill: () => { for (const session of sessions.values()) session.worker.kill('SIGKILL'); },
  };
}

module.exports = { createDriving, canControl };
