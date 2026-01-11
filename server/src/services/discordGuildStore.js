const fs = require('fs');
const path = require('path');
const logger = require('../globals/logger').child('discordGuildStore');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'discord-guilds.json');
const VALID_MODES = new Set(['global', 'private']);

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to load guild store', err.message);
    }
    cache = {};
  }
  return cache;
}

function saveStore(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = next;
}

function normalizeMode(input, fallback = 'global') {
  const candidate = String(input || '').trim().toLowerCase();
  if (VALID_MODES.has(candidate)) return candidate;
  return fallback;
}

function listGuildConfigs() {
  const store = loadStore();
  return Object.values(store);
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  return store[String(guildId)] || null;
}

function setGuildConfig(guildId, { channelId, mode }) {
  if (!guildId) {
    throw new Error('guildId required');
  }
  const store = { ...loadStore() };
  const now = Date.now();
  const key = String(guildId);
  const prev = store[key] || null;
  const next = {
    guildId: key,
    channelId: channelId != null ? String(channelId) : prev?.channelId || null,
    mode: normalizeMode(mode, prev?.mode || 'global'),
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  store[key] = next;
  saveStore(store);
  return next;
}

function removeGuildConfig(guildId) {
  if (!guildId) return;
  const store = { ...loadStore() };
  delete store[String(guildId)];
  saveStore(store);
}

module.exports = {
  getGuildConfig,
  listGuildConfigs,
  setGuildConfig,
  removeGuildConfig,
  normalizeMode,
  VALID_MODES,
};
