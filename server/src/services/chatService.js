const { v4: uuidv4 } = require('uuid');
const { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers } = require('obscenity');
const io = require('../globals/io');
const logger = require('../globals/logger').child('chatService');
const { publishEvent, subscribe } = require('./eventBus');
const { getRole } = require('./roleService');
const { getMode, MODES } = require('./modeManager');
const { describeAssignment } = require('./assignmentService');
const roverManager = require('./roverManager');
const { getNickname } = require('./nicknameService');
const { issueCommand } = require('./commandService');
const { getAdminReason } = require('./adminReasonService');

const RATE_LIMIT_WINDOW_MS = 8000;
const RATE_LIMIT_MAX = 5;
const rateBuckets = new Map(); // socketId -> [timestamps]

const MAX_HISTORY = 100;
const history = [];

// Words in this list are removed from the profanity dataset entirely.
const PROFANITY_ALLOWLIST = ['fuck', 'ass', 'shit'];
const normalizedProfanityAllowlist = new Set(PROFANITY_ALLOWLIST
  .filter((term) => typeof term === 'string')
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean));
const profanityDataset = new DataSet()
  .addAll(englishDataset)
  .removePhrasesIf((phrase) => normalizedProfanityAllowlist.has(phrase.metadata?.originalWord))
  .build();
const profanityMatcher = new RegExpMatcher({
  ...profanityDataset,
  ...englishRecommendedTransformers,
  whitelistedTerms: profanityDataset.whitelistedTerms,
});
const DUPLICATE_WINDOW_MS = 15000;
const lastMessageBySocket = new Map(); // socketId -> { text, ts }
const typingBySocket = new Map(); // socketId -> boolean
const TYPING_START_NOTE = 72;
const TYPING_SEND_NOTE = 79;
const TYPING_NOTE_DURATION = 8;
const ACCESS_NOTICE_COOLDOWN_MS = 60000;
const ACCESS_KEYWORD_RE = /\b(drive|roomba)\b/i;
let lastAccessNoticeAt = 0;

function withinRateLimit(socketId) {
  const now = Date.now();
  const entries = rateBuckets.get(socketId) || [];
  const next = entries.filter((ts) => now - ts <= RATE_LIMIT_WINDOW_MS);
  next.push(now);
  rateBuckets.set(socketId, next);
  return next.length <= RATE_LIMIT_MAX;
}

function hasProfanity(text) {
  if (typeof text !== 'string' || !text) return false;
  return profanityMatcher.hasMatch(text);
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
    discordGuildId: meta.discordGuildId || null,
    discordGuildName: meta.discordGuildName || null,
    discordGuildIconUrl: meta.discordGuildIconUrl || null,
    discordChannelId: meta.discordChannelId || null,
    discordUserId: meta.discordUserId || null,
    discordUserName: meta.discordUserName || null,
    discordUserAvatarUrl: meta.discordUserAvatarUrl || null,
    roverCtx: meta.roverCtx || null,
    text,
    tts: meta.tts || null,
    system: Boolean(meta.system),
  };
}

function isChargingFromSensors(sensors = {}) {
  const label = String(sensors?.chargingState?.label || '').toLowerCase();
  if (label === 'waiting' || label === 'full charging' || label === 'trickle charging') {
    return true;
  }
  const code = sensors?.chargingState?.code;
  return code === 2 || code === 3 || code === 4;
}

function buildRoverCtxSnapshot(roverId) {
  if (!roverId) return null;
  const key = String(roverId);
  const record = roverManager.rovers.get(key);
  if (!record) return null;
  const sensors = record?.lastSensor?.decoded || {};
  const batteryState = record?.batteryState || null;
  const { getActiveDrivers } = require('./turnService');
  const activeDrivers = getActiveDrivers();
  const driverSocketId = activeDrivers[key] || record?.drivers?.values?.().next?.().value || null;
  const charging = isChargingFromSensors(sensors);
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const wheelsOffGround = Boolean(
    sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight,
  );
  const latestDistanceM = Math.round((Math.abs(Number(sensors?.distanceMm) || 0) / 1000) * 10) / 10;
  const latestTurnDeg = Math.round(Math.abs(Number(sensors?.angleDeg) || 0));
  const latestBumps =
    (sensors?.bumpsAndWheelDrops?.bumpLeft ? 0.5 : 0) +
    (sensors?.bumpsAndWheelDrops?.bumpRight ? 0.5 : 0);
  const moving = latestDistanceM > 0.05 || latestTurnDeg > 10;
  let statusTag = 'idle';
  if (charging) {
    statusTag = 'charging';
  } else if (docked) {
    statusTag = 'docked';
  } else if (driverSocketId && moving) {
    statusTag = 'driving';
  } else if (driverSocketId) {
    statusTag = 'active-idle';
  }
  return {
    id: key,
    status_tag: statusTag,
    battery_low: Boolean(batteryState?.warnActive || batteryState?.urgentActive),
    docked,
    charging,
    wheels_off_ground: wheelsOffGround,
    activity_30s: {
      distance_m: latestDistanceM,
      turn_deg: latestTurnDeg,
      bumps: latestBumps,
    },
  };
}

function buildTypingPayload(socket, meta = {}) {
  const roverId = meta.roverId || resolveRoverId(socket?.id);
  const socketId = socket?.id || null;
  const fromDiscord = Boolean(meta.fromDiscord);
  let typingId = meta.typingId || null;
  if (!typingId) {
    if (fromDiscord) {
      if (meta.discordUserId) {
        typingId = `discord:${meta.discordUserId}`;
      } else if (meta.discordUserName) {
        typingId = `discord:${meta.discordUserName}`;
      } else if (meta.nickname) {
        typingId = `discord:${meta.nickname}`;
      } else {
        typingId = 'discord:unknown';
      }
    } else if (socketId) {
      typingId = `socket:${socketId}`;
    } else if (meta.nickname) {
      typingId = `socket:${meta.nickname}`;
    } else {
      typingId = 'socket:unknown';
    }
  }
  return {
    id: uuidv4(),
    ts: Date.now(),
    typingId,
    isTyping: Boolean(meta.isTyping),
    socketId,
    nickname: meta.nickname || getNickname(socket) || null,
    role: meta.role || getRole(socket),
    roverId,
    fromDiscord,
    discordGuildId: meta.discordGuildId || null,
    discordGuildName: meta.discordGuildName || null,
    discordGuildIconUrl: meta.discordGuildIconUrl || null,
    discordChannelId: meta.discordChannelId || null,
    discordUserId: meta.discordUserId || null,
    discordUserName: meta.discordUserName || null,
    discordUserAvatarUrl: meta.discordUserAvatarUrl || null,
  };
}

function pushHistory(message) {
  history.push(message);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function getRecentMessages(limit = 20, options = {}) {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  const includeSystem = options?.includeSystem !== false;
  const source = includeSystem ? history : history.filter((entry) => !entry?.system);
  return source.slice(-safeLimit);
}

function broadcastMessage(message) {
  pushHistory(message);
  publishEvent({ source: 'chat', type: 'chat:message', payload: message });
}

function broadcastTyping(payload) {
  publishEvent({ source: 'chat', type: 'chat:typing', payload });
}

function playTypingNote(roverId, note, socketId) {
  if (!roverId) return;
  try {
    issueCommand(roverId, {
      type: 'song',
      song: {
        notes: [{ note, duration: TYPING_NOTE_DURATION }],
      },
    });
    const log = typeof logger.debug === 'function' ? logger.debug.bind(logger) : logger.info.bind(logger);
    log('Typing tone sent', { roverId, note, socketId });
  } catch (err) {
    const log = typeof logger.debug === 'function' ? logger.debug.bind(logger) : logger.info.bind(logger);
    log('Typing tone failed', { roverId, note, socketId, error: err.message });
  }
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

function buildAccessNoticeText(mode, reasonText) {
  const label = mode === MODES.LOCKDOWN ? 'lockdown' : 'admin';
  const reason = reasonText ? ` Reason: ${reasonText}` : '';
  return `Heads up: the server is in ${label} mode.${reason}`;
}

function shouldSendAccessNotice(message) {
  if (!message?.text || message.system) return false;
  const mode = getMode();
  if (mode !== MODES.ADMIN && mode !== MODES.LOCKDOWN) return false;
  if (!ACCESS_KEYWORD_RE.test(message.text)) return false;
  const now = Date.now();
  if (now - lastAccessNoticeAt < ACCESS_NOTICE_COOLDOWN_MS) return false;
  lastAccessNoticeAt = now;
  return true;
}

function sendSystemMessage(text) {
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  if (!clean) return null;
  const safe = clean.length > 256 ? `${clean.slice(0, 253)}...` : clean;
  const message = buildMessage(null, safe, {
    nickname: 'The Overseer',
    role: 'user',
    fromDiscord: false,
    system: true,
  });
  broadcastMessage(message);
  return message;
}

function maybeSendAccessNotice(message) {
  if (!shouldSendAccessNotice(message)) return;
  const reason = getAdminReason()?.text || '';
  const mode = getMode();
  const notice = buildAccessNoticeText(mode, reason);
  sendSystemMessage(notice);
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
  if (clean.length > 400) {
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
  // if (isKeymash(clean)) {
  //   cb({ error: 'Message looks like spam' });
  //   return;
  // }
  const roverId = resolveRoverId(socket?.id);
  const ttsOptions = normalizeTtsOptions(tts);
  const message = buildMessage(socket, clean, {
    fromDiscord: false,
    roverId,
    roverCtx: buildRoverCtxSnapshot(roverId),
    tts: ttsOptions,
  });
  logger.info('Chat message', { socket: socket.id, roverId: message.roverId });
  playTypingNote(roverId, TYPING_SEND_NOTE, socket?.id);
  broadcastMessage(message);
  maybeSendAccessNotice(message);
  maybeSpeak(socket, message, ttsOptions);
  cb({ success: true });
}

function maybeSpeak(socket, message, ttsOptions) {
  if (!ttsOptions || !message?.roverId) return;
  const record = roverManager.rovers.get(message.roverId);
  const audio = record?.meta?.audio || {};
  const ttsEnabled = Boolean(audio.ttsEnabled);
  if (!ttsEnabled) return;
  const { isQueuedDriver } = require('./turnService');
  if (
    !roverManager.canDrive(message.roverId, socket) &&
    !isQueuedDriver(message.roverId, socket?.id)
  ) {
    return;
  }
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

function sendExternalMessage({
  text,
  nickname = 'Discord',
  role = 'admin',
  roverId = null,
  discordGuildId = null,
  discordGuildName = null,
  discordGuildIconUrl = null,
  discordChannelId = null,
  discordUserId = null,
  discordUserName = null,
  discordUserAvatarUrl = null,
}) {
  const normalized = normalizeUserText(text);
  const clean = normalized.trim();
  if (!clean || clean.length > 400) {
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
    roverCtx: buildRoverCtxSnapshot(roverId),
    fromDiscord: true,
    discordGuildId,
    discordGuildName,
    discordGuildIconUrl,
    discordChannelId,
    discordUserId,
    discordUserName,
    discordUserAvatarUrl,
  });
  logger.info('External chat message', { roverId, nickname });
  broadcastMessage(message);
  maybeSendAccessNotice(message);
  return message;
}

function sendExternalTyping({
  nickname = 'Discord',
  role = 'user',
  roverId = null,
  discordGuildId = null,
  discordGuildName = null,
  discordGuildIconUrl = null,
  discordChannelId = null,
  discordUserId = null,
  discordUserName = null,
  discordUserAvatarUrl = null,
  isTyping = true,
}) {
  const payload = buildTypingPayload(null, {
    nickname,
    role,
    roverId,
    fromDiscord: true,
    discordGuildId,
    discordGuildName,
    discordGuildIconUrl,
    discordChannelId,
    discordUserId,
    discordUserName,
    discordUserAvatarUrl,
    isTyping,
  });
  broadcastTyping(payload);
  return payload;
}

io.on('connection', (socket) => {
  socket.emit('chat:init', history);
  socket.on('chat:send', (payload = {}, cb = () => {}) => handleIncoming(payload, socket, cb));
  socket.on('chat:typing', (payload = {}) => {
    const isTyping = Boolean(payload?.isTyping);
    const wasTyping = typingBySocket.get(socket.id);
    if (isTyping) {
      typingBySocket.set(socket.id, true);
      if (!wasTyping) {
        const roverId = resolveRoverId(socket?.id);
        playTypingNote(roverId, TYPING_START_NOTE, socket?.id);
      }
    } else {
      typingBySocket.delete(socket.id);
    }
    const roverId = resolveRoverId(socket?.id);
    const typingPayload = buildTypingPayload(socket, { roverId, fromDiscord: false, isTyping });
    broadcastTyping(typingPayload);
  });
  socket.on('disconnect', () => {
    if (!typingBySocket.has(socket.id)) return;
    typingBySocket.delete(socket.id);
    const roverId = resolveRoverId(socket?.id);
    const typingPayload = buildTypingPayload(socket, { roverId, fromDiscord: false, isTyping: false });
    broadcastTyping(typingPayload);
  });
});

subscribe('chat:message', ({ payload }) => {
  if (!payload) return;
  io.emit('chat:message', payload);
});

subscribe('chat:typing', ({ payload }) => {
  if (!payload) return;
  io.emit('chat:typing', payload);
});

module.exports = {
  handleIncoming,
  sendExternalMessage,
  sendExternalTyping,
  buildTypingPayload,
  sendSystemMessage,
  getRecentMessages,
};
