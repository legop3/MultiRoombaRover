const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const logger = require('../globals/logger').child('chatService');
const { publishEvent, subscribe } = require('./eventBus');
const { getRole } = require('./roleService');
const { describeAssignment } = require('./assignmentService');
const roverManager = require('./roverManager');
const { getNickname } = require('./nicknameService');

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

function buildMessage(socket, text) {
  const roverId = resolveRoverId(socket.id);
  return {
    id: uuidv4(),
    ts: Date.now(),
    socketId: socket.id,
    nickname: getNickname(socket) || null,
    role: getRole(socket),
    roverId,
    text,
  };
}

function broadcastMessage(message) {
  publishEvent({ source: 'chat', type: 'chat:message', payload: message });
}

function handleIncoming({ text } = {}, socket, cb = () => {}) {
  const role = getRole(socket);
  if (role === 'spectator') {
    cb({ error: 'Spectators cannot chat' });
    return;
  }
  const clean = typeof text === 'string' ? text.trim() : '';
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
  const message = buildMessage(socket, clean);
  logger.info('Chat message', { socket: socket.id, roverId: message.roverId });
  broadcastMessage(message);
  cb({ success: true });
}

io.on('connection', (socket) => {
  socket.on('chat:send', (payload = {}, cb = () => {}) => handleIncoming(payload, socket, cb));
});

subscribe('chat:message', ({ payload }) => {
  if (!payload) return;
  io.emit('chat:message', payload);
});
