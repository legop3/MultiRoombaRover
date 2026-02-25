const fsp = require('fs/promises');
const path = require('path');
const io = require('../globals/io');
const logger = require('../globals/logger').child('llmCommentary');
const { loadConfig } = require('../helpers/configLoader');
const roverManager = require('./roverManager');
const { getActiveDrivers } = require('./turnService');
const { getNickname } = require('./nicknameService');
const { getRecentMessages, sendSystemMessage } = require('./chatService');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'commentary_system.txt');
const DEFAULT_FREQUENCY_MS = 120000;
const MIN_FREQUENCY_MS = 15000;
const JITTER_MS = 30000;
const MAX_ROVERS = 8;
const MAX_CHAT_MESSAGES = 12;
const MAX_BOT_MESSAGES = 6;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_OUTPUT_CHARS = 140;
const SKIP_TOKEN = 'SKIP';

const config = loadConfig();
const commentaryConfig = config.llmCommentary || {};
const enabled = Boolean(commentaryConfig.enabled);
const ollamaUrl = String(commentaryConfig.ollamaUrl || '').trim();
const model = String(commentaryConfig.model || '').trim();
const timezone = String(config.timezone || 'UTC');

let timer = null;
let inFlight = false;

function normalizeFrequencyMs(value) {
  if (!Number.isFinite(value)) return DEFAULT_FREQUENCY_MS;
  return Math.max(MIN_FREQUENCY_MS, Math.floor(value));
}

const frequencyMs = normalizeFrequencyMs(Number(commentaryConfig.frequencyMs));

function localTimeString(date, tz) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function isChargingFromSensors(sensors = {}) {
  const label = String(sensors?.chargingState?.label || '').toLowerCase();
  if (label === 'waiting' || label === 'full charging' || label === 'trickle charging') {
    return true;
  }
  const code = sensors?.chargingState?.code;
  return code === 2 || code === 3 || code === 4;
}

function resolveDriverNickname(socketId) {
  if (!socketId) return null;
  const socket = io.sockets.sockets.get(socketId);
  return getNickname(socket) || socket?.data?.user?.username || socketId.slice(0, 6);
}

function buildSnapshot() {
  const now = new Date();
  const activeDrivers = getActiveDrivers();
  const driverEntries = Object.entries(activeDrivers).filter(([, socketId]) => Boolean(socketId));
  if (driverEntries.length === 0) {
    return null;
  }

  const roster = roverManager.getRoster().slice(0, MAX_ROVERS);
  const rovers = roster.map((entry) => {
    const roverId = String(entry.id);
    const record = roverManager.rovers.get(roverId);
    const sensors = record?.lastSensor?.decoded || {};
    const batteryState = entry.batteryState || null;
    const driverSocketId = activeDrivers[roverId] || null;
    return {
      id: roverId,
      name: entry.name || roverId,
      locked: Boolean(entry.locked),
      docked: Boolean(sensors?.chargingSources?.homeBase),
      charging: isChargingFromSensors(sensors),
      battery_percent: batteryState?.percentDisplay ?? null,
      battery_warn: Boolean(batteryState?.warnActive),
      battery_urgent: Boolean(batteryState?.urgentActive),
      oi_mode: sensors?.oiMode?.label || null,
      active_driver: driverSocketId
        ? {
            nickname: resolveDriverNickname(driverSocketId),
          }
        : null,
    };
  });

  const drivers = driverEntries.map(([roverId, socketId]) => ({
    rover_id: String(roverId),
    nickname: resolveDriverNickname(socketId),
  }));

  const chatRecent = getRecentMessages(MAX_CHAT_MESSAGES, { includeSystem: false }).map((entry) => ({
    ts_iso: new Date(entry.ts).toISOString(),
    nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
    text: entry.text || '',
  }));

  const botRecent = getRecentMessages(30, { includeSystem: true })
    .filter((entry) => entry?.system)
    .slice(-MAX_BOT_MESSAGES)
    .map((entry) => ({
      ts_iso: new Date(entry.ts).toISOString(),
      text: entry.text || '',
    }));

  return {
    now: {
      iso: now.toISOString(),
      local: localTimeString(now, timezone),
      timezone,
      unix_ms: now.getTime(),
    },
    activity: {
      active_driver_count: driverEntries.length,
      driving_rovers: driverEntries.map(([roverId]) => String(roverId)),
    },
    rovers,
    drivers,
    chat_recent: chatRecent,
    bot_recent_messages: botRecent,
  };
}

function normalizeCommentary(rawText) {
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === SKIP_TOKEN) return null;
  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  if (firstLine.toUpperCase() === SKIP_TOKEN) return null;
  const normalized = firstLine.replace(/\s+/g, ' ');
  if (normalized.length <= MAX_OUTPUT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_OUTPUT_CHARS - 3)}...`;
}

async function readSystemPrompt() {
  const prompt = await fsp.readFile(PROMPT_PATH, 'utf8');
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error(`Prompt file empty: ${PROMPT_PATH}`);
  }
  return trimmed;
}

async function generateCommentary(systemPrompt, snapshot) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${ollamaUrl.replace(/\/+$/, '')}/api/chat`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: -1,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 80,
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(snapshot) },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama error ${response.status}: ${body.slice(0, 200)}`);
    }
    const payload = await response.json();
    return normalizeCommentary(payload?.message?.content);
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleNextTick() {
  const delay = frequencyMs + Math.floor(Math.random() * (JITTER_MS + 1));
  timer = setTimeout(runTick, delay);
}

async function runTick() {
  if (inFlight) {
    scheduleNextTick();
    return;
  }
  inFlight = true;
  try {
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    const systemPrompt = await readSystemPrompt();
    const text = await generateCommentary(systemPrompt, snapshot);
    if (!text) return;
    const recentBotMessages = snapshot.bot_recent_messages || [];
    const duplicate = recentBotMessages.some(
      (entry) => String(entry?.text || '').trim().toLowerCase() === text.toLowerCase(),
    );
    if (duplicate) return;
    sendSystemMessage(text);
  } catch (err) {
    logger.warn('Commentary tick failed', err.message);
  } finally {
    inFlight = false;
    scheduleNextTick();
  }
}

function start() {
  if (!enabled) {
    logger.info('LLM commentary disabled');
    return;
  }
  if (!model || !ollamaUrl) {
    logger.warn('LLM commentary disabled; model or ollamaUrl missing');
    return;
  }
  logger.info('LLM commentary enabled', { model, ollamaUrl, frequencyMs, promptPath: PROMPT_PATH });
  scheduleNextTick();
}

start();
