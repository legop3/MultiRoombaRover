const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const logger = require('../globals/logger').child('chatService');
const { publishEvent, subscribe } = require('./eventBus');
const { getRole } = require('./roleService');
const { describeAssignment } = require('./assignmentService');
const roverManager = require('./roverManager');
const { getNickname } = require('./nicknameService');
const { issueCommand } = require('./commandService');

const RATE_LIMIT_WINDOW_MS = 8000;
const RATE_LIMIT_MAX = 5;
const rateBuckets = new Map(); // socketId -> [timestamps]

const PROFANITY_LIST = ['bitch', 'cunt', 'nigger', 'nigga', 'asshole', 'dick'];
const DUPLICATE_WINDOW_MS = 15000;
const lastMessageBySocket = new Map(); // socketId -> { text, ts }

function withinRateLimit(socketId) {
  const now = Date.now();
  const entries = rateBuckets.get(socketId) || [];
  const next = entries.filter((ts) => now - ts <= RATE_LIMIT_WINDOW_MS);
  next.push(now);
  rateBuckets.set(socketId, next);
  return next.length <= RATE_LIMIT_MAX;
}

function hasProfanity(text) {
  const lower = text.toLowerCase();
  return PROFANITY_LIST.some((word) => lower.includes(word));
}

function isDuplicate(socketId, text) {
  const prev = lastMessageBySocket.get(socketId);
  const now = Date.now();
  if (!prev) {
    lastMessageBySocket.set(socketId, { text, ts: now });
    return false;
  }
  lastMessageBySocket.set(socketId, { text, ts: now });
  return prev.text === text && now - prev.ts <= DUPLICATE_WINDOW_MS;
}

function isKeymash(text) {
  if (!text) return false;
  if (/(.)\1{6,}/.test(text)) return true; // same char 7+
  if (/^[asdfghjkl;'\-=\[\]\\]{6,}$/i.test(text)) return true;
  if (/^[qwertyuiop]{6,}$/i.test(text)) return true;
  return false;
}

function resolveRoverId(socketId) {
  const primary = roverManager.getPrimaryRoverForSocket(socketId);
  if (primary) return primary;
  const assignment = describeAssignment(socketId);
  return assignment?.roverId || null;
}

function normalizeUserText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\\n/g, '\n');
}

function buildMessage(socket, text, meta = {}) {
  const roverId = meta.roverId || resolveRoverId(socket?.id);
  return {
    id: uuidv4(),
    ts: Date.now(),
    socketId: socket?.id || null,
    nickname: meta.nickname || getNickname(socket) || null,
    role: meta.role || getRole(socket),
    roverId,
    fromDiscord: Boolean(meta.fromDiscord),
    text,
    tts: meta.tts || null,
  };
}

function broadcastMessage(message) {
  publishEvent({ source: 'chat', type: 'chat:message', payload: message });
}

function normalizeTtsOptions(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const speak = raw.speak !== false;
  if (!speak) return null;
  const engine = typeof raw.engine === 'string' && raw.engine.toLowerCase() === 'espeak' ? 'espeak' : 'flite';
  const voice = typeof raw.voice === 'string' ? raw.voice.trim() : undefined;
  let pitch = Number.isFinite(raw.pitch) ? Math.round(raw.pitch) : undefined;
  if (typeof pitch === 'number') {
    pitch = Math.max(0, Math.min(99, pitch));
  }
  return { speak, engine, voice, pitch };
}

function handleIncoming({ text, tts } = {}, socket, cb = () => {}) {
  const role = getRole(socket);
  // if (role === 'spectator') {
  //   cb({ error: 'Spectators cannot chat' });
  //   return;
  // }
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  if (!clean) {
    cb({ error: 'Message required' });
    return;
  }
  if (!withinRateLimit(socket.id)) {
    cb({ error: 'Slow down' });
    return;
  }
  if (clean.length > 256) {
    cb({ error: 'Message too long' });
    return;
  }
  if (hasProfanity(clean)) {
    cb({ error: 'Message blocked' });
    return;
  }
  // if (isDuplicate(socket.id, clean)) {
  //   cb({ error: 'Duplicate message' });
  //   return;
  // }
  if (isKeymash(clean)) {
    cb({ error: 'Message looks like spam' });
    return;
  }
  const roverId = resolveRoverId(socket?.id);
  const ttsOptions = normalizeTtsOptions(tts);
  const message = buildMessage(socket, clean, { fromDiscord: false, roverId, tts: ttsOptions });
  logger.info('Chat message', { socket: socket.id, roverId: message.roverId });
  broadcastMessage(message);
  maybeSpeak(socket, message, ttsOptions);
  cb({ success: true });
}

function maybeSpeak(socket, message, ttsOptions) {
  if (!ttsOptions || !message?.roverId) return;
  const record = roverManager.rovers.get(message.roverId);
  const audio = record?.meta?.audio || {};
  const ttsEnabled = Boolean(audio.ttsEnabled);
  if (!ttsEnabled) return;
  // if (!roverManager.canDrive(message.roverId, socket)) return;
  try {
    issueCommand(message.roverId, {
      type: 'tts',
      tts: {
        text: message.text,
        engine: ttsOptions.engine,
        voice: ttsOptions.voice,
        pitch: ttsOptions.pitch,
        speak: true,
      },
    });
    logger.info('TTS sent', { roverId: message.roverId, engine: ttsOptions.engine, socket: socket.id });
  } catch (err) {
    logger.warn('TTS send failed', { roverId: message.roverId, error: err.message });
  }
}

function sendExternalMessage({ text, nickname = 'Discord', role = 'admin', roverId = null }) {
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  if (!clean || clean.length > 256) {
    throw new Error('Message invalid');
  }
  if (hasProfanity(clean)) {
    throw new Error('Message blocked');
  }
  if (isKeymash(clean)) {
    throw new Error('Message looks like spam');
  }
  const message = buildMessage(null, clean, {
    nickname,
    role,
    roverId,
    fromDiscord: true,
  });
  logger.info('External chat message', { roverId, nickname });
  broadcastMessage(message);
  return message;
}

io.on('connection', (socket) => {
  socket.on('chat:send', (payload = {}, cb = () => {}) => handleIncoming(payload, socket, cb));
});

subscribe('chat:message', ({ payload }) => {
  if (!payload) return;
  io.emit('chat:message', payload);
});

module.exports = {
  handleIncoming,
  sendExternalMessage,
};
