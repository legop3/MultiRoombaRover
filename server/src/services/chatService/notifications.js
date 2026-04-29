// Chat Rover Notifications
// Purpose: Sends rover typing tones, optional rover TTS, and access-mode system notices.
// Scope: Owns rover-side notification effects derived from chat activity.
const logger = require('../../globals/logger').child('chatService');
const { getMode, MODES } = require('../modeManager');
const { getRole } = require('../roleService');
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const { getAdminReason } = require('../adminReasonService');
const {
  TYPING_NOTE_DURATION,
  ACCESS_NOTICE_COOLDOWN_MS,
  ACCESS_KEYWORD_RE,
  TYPING_START_NOTE,
  TYPING_SEND_NOTE,
} = require('./constants');
const { getLastAccessNoticeAt, setLastAccessNoticeAt } = require('./state');

function playTypingNote(roverId, note, socketId) {
  if (!roverId) return;
  try {
    issueCommand(roverId, {
      type: 'song',
      song: { notes: [{ note, duration: TYPING_NOTE_DURATION }] },
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
  if (typeof pitch === 'number') pitch = Math.max(0, Math.min(99, pitch));
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
  if (now - getLastAccessNoticeAt() < ACCESS_NOTICE_COOLDOWN_MS) return false;
  setLastAccessNoticeAt(now);
  return true;
}

function maybeSendAccessNotice(message, sendSystemMessage) {
  if (!shouldSendAccessNotice(message)) return;
  const reason = getAdminReason()?.text || '';
  const notice = buildAccessNoticeText(getMode(), reason);
  sendSystemMessage(notice);
}

function maybeSpeak(socket, message, ttsOptions) {
  if (!ttsOptions || !message?.roverId) return;
  const record = roverManager.rovers.get(message.roverId);
  const ttsEnabled = Boolean(record?.meta?.audio?.ttsEnabled);
  if (!ttsEnabled) return;
  const { isQueuedDriver } = require('../turnService');
  if (!roverManager.canDrive(message.roverId, socket) && !isQueuedDriver(message.roverId, socket?.id)) return;
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

module.exports = {
  playTypingNote,
  normalizeTtsOptions,
  maybeSendAccessNotice,
  maybeSpeak,
  TYPING_START_NOTE,
  TYPING_SEND_NOTE,
};
