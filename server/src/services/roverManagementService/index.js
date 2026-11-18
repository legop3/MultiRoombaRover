const { randomUUID } = require('node:crypto');
const io = require('../../globals/io');
const { managementWSS } = require('../../globals/ws');
const { isAdmin } = require('../roleService');
const { sendAlert } = require('../alertService');
const logger = require('../../globals/logger').child('roverManagement');

// Management availability is independent of the control roster: a rover with
// failed hardware must still be configurable. All state here is memory-only.
const rovers = new Map();
const pending = new Map();
const MAX_MESSAGE_BYTES = 1024 * 1024;

function snapshot(record) {
  return {
    roverId: record.roverId,
    config: record.config,
    schema: record.schema,
    profiles: record.profiles,
    mediaStatus: record.mediaStatus,
    mediaOutput: record.mediaOutput,
    updateStatus: record.updateStatus,
    hostStats: record.hostStats || null,
    notices: record.notices,
  };
}

function notifyAdmins(event, value) {
  for (const socket of io.sockets.sockets.values()) {
    if (isAdmin(socket)) socket.emit(event, value);
  }
}

function finish(id, error, ack) {
  const item = pending.get(id);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(id);
  if (error) item.reject(error); else item.resolve(ack);
}

function request(roverId, payload) {
  const record = rovers.get(String(roverId));
  if (!record || record.ws.readyState !== 1) throw new Error('Rover management offline');
  const id = randomUUID();
  const data = JSON.stringify({ ...payload, id });
  if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES) throw new Error('Management request too large');
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(id, new Error('Rover management acknowledgement timed out')), 30000);
    pending.set(id, { roverId: record.roverId, ws: record.ws, resolve, reject, timer });
    try {
      record.ws.send(data, (error) => { if (error) finish(id, error); });
    } catch (error) { finish(id, error); }
  });
  return { id, result };
}

// Existing reboot/update callers retain their permission gates and commandAck
// UI, but transport and acknowledgement ownership now live on management.
function issueCommand(roverId, payload) {
  const { id, result } = request(roverId, payload);
  result.then(
    () => io.emit('commandAck', { roverId, id, status: 'ok' }),
    (error) => io.emit('commandAck', { roverId, id, status: 'error', error: error.message }),
  );
  return id;
}

managementWSS.on('connection', (ws) => {
  let record;
  let alive = true;
  const helloTimeout = setTimeout(() => ws.terminate(), 10000);
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15000);
  ws.on('pong', () => { alive = true; });
  ws.on('error', (error) => logger.warn('Management socket error', error.message));
  ws.on('message', (raw) => {
    alive = true;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello' && !record) {
        if (typeof msg.name !== 'string' || !msg.name || !msg.config || !msg.schema) throw new Error('Invalid management hello');
        clearTimeout(helloTimeout);
        const previous = rovers.get(msg.name);
        record = { roverId: msg.name, ws, config: msg.config, schema: msg.schema, profiles: msg.profiles, mediaStatus: msg.mediaStatus || {}, mediaOutput: {}, updateStatus: msg.updateStatus || null, notices: [] };
        rovers.set(record.roverId, record);
        previous?.ws.close(1000, 'Replaced by new connection');
        notifyAdmins('roverManagement:changed', snapshot(record));
        return;
      }
      if (!record || rovers.get(record.roverId) !== record) return;
      if (msg.type === 'ack') {
        if (pending.get(msg.id)?.ws !== ws) return;
        finish(msg.id, msg.status === 'ok' ? null : new Error(msg.error || 'Management action failed'), msg);
      } else if (msg.type === 'updateStatus') {
        record.updateStatus = msg.status;
        notifyAdmins('roverManagement:updateStatus', { roverId: record.roverId, status: msg.status });
      } else if (msg.type === 'hostStats') {
        record.hostStats = msg;
        require('../roverManager').handleHostStats(record.roverId, msg);
        notifyAdmins('roverManagement:hostStats', { roverId: record.roverId, ...msg });
      } else if (msg.type === 'event') {
        if (msg.event === 'media.status') record.mediaStatus[msg.data.category] = msg.data.message;
        if (msg.event === 'media.output') {
          const category = msg.data?.category;
          if (['video', 'audioCapture', 'audioPlayback'].includes(category)) {
            // Keep raw chunks per command so other streamers/notices cannot evict them.
            record.mediaOutput[category] = ((record.mediaOutput[category] || '') + (msg.data.message || '')).slice(-65536);
          }
        } else {
          record.notices.push(msg);
          if (record.notices.length > 100) record.notices.shift();
        }
        notifyAdmins('roverManagement:event', { roverId: record.roverId, ...msg });
        if (!msg.event?.startsWith('media.')) sendAlert({ color: '#00bcd4', title: record.roverId, message: msg.data?.message || msg.event });
      }
    } catch (error) {
      logger.warn('Invalid management message', error.message);
      ws.close(1008, 'Invalid management message');
    }
  });
  ws.on('close', () => {
    clearTimeout(helloTimeout);
    clearInterval(heartbeat);
    for (const [id, item] of pending) {
      if (item.ws === ws) finish(id, new Error('Rover management disconnected before acknowledgement'));
    }
    if (record && rovers.get(record.roverId) === record) {
      rovers.delete(record.roverId);
      notifyAdmins('roverManagement:offline', { roverId: record.roverId });
    }
  });
});

io.on('connection', (socket) => {
  const bind = (event, handler) => socket.on(event, async (payload = {}, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    try {
      if (!isAdmin(socket)) throw new Error('Not authorized');
      reply({ success: true, ...await handler(payload) });
    } catch (error) { reply({ error: error.message }); }
  });
  bind('roverManagement:list', () => ({ rovers: [...rovers.values()].map(snapshot) }));
  bind('roverManagement:get', ({ roverId }) => {
    const record = rovers.get(String(roverId));
    if (!record) throw new Error('Rover management offline');
    return snapshot(record);
  });
  bind('roverManagement:save', async ({ roverId, config }) => {
    const { id, result } = request(roverId, { type: 'config.set', config });
    await result;
    // The next hello is authoritative; do not replace cached state optimistically.
    return { id };
  });
  bind('roverManagement:applyField', async ({ path, value }) => {
    if (!Array.isArray(path) || path.length === 0 || value === undefined
      || path.some((key) => typeof key !== 'string' || !key
        || ['__proto__', 'constructor', 'prototype'].includes(key))) {
      throw new Error('A nonempty field path and value are required');
    }
    // Snapshot the connected fleet before any save restarts a rover. Each
    // object is independent; never copy one rover's unrelated settings across.
    const targets = [...rovers.values()];
    const results = await Promise.all(targets.map(async (record) => {
      try {
        const config = structuredClone(record.config);
        let parent = config;
        for (const key of path.slice(0, -1)) {
          if (!parent || typeof parent !== 'object' || Array.isArray(parent)
            || !Object.hasOwn(parent, key)) throw new Error('Field does not exist on this rover');
          parent = parent[key];
        }
        const key = path.at(-1);
        if (!parent || typeof parent !== 'object' || Array.isArray(parent)
          || !Object.hasOwn(parent, key)) throw new Error('Field does not exist on this rover');
        parent[key] = structuredClone(value);
        // Do not submit a stale snapshot to a replacement connection.
        if (rovers.get(record.roverId) !== record) throw new Error('Rover connection changed');
        const { id, result } = request(record.roverId, { type: 'config.set', config });
        await result;
        return { roverId: record.roverId, success: true, id };
      } catch (error) {
        return { roverId: record.roverId, success: false, error: error.message };
      }
    }));
    return { results };
  });
  bind('roverManagement:saveProfile', async ({ roverId, category, profile, config }) => {
    const { id, result } = request(roverId, { type: 'profile.set', category, profile, config });
    await result;
    return { id };
  });
  bind('roverManagement:command', async ({ roverId, type, reboot }) => {
    if (!['reboot', 'update'].includes(type)) throw new Error('Unsupported management command');
    const { id, result } = request(roverId, { type, reboot });
    await result;
    return { id };
  });
});

module.exports = { rovers, request, issueCommand };
