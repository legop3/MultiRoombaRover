const fs = require('fs');
const { resolveDataPath } = require('../../helpers/dataPaths');

const STORE_PATH = resolveDataPath('overseer-control-memory.json');

function createDefaultMemory() {
  return ['', '', ''];
}

function sanitizeSlots(slots) {
  const next = Array.isArray(slots) ? slots.slice(0, 3) : [];
  while (next.length < 3) next.push('');
  return next.map((entry) => String(entry || '').slice(0, 180));
}

function loadMemory() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return sanitizeSlots(raw?.slots);
  } catch {
    return createDefaultMemory();
  }
}

function saveMemory(slots) {
  const next = sanitizeSlots(slots);
  const payload = { updatedAt: Date.now(), slots: next };
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return next;
}

module.exports = {
  loadMemory,
  saveMemory,
  createDefaultMemory,
};
