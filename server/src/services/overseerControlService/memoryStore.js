const fs = require('fs');
const { resolveDataPath } = require('../../helpers/dataPaths');

const STORE_PATH = resolveDataPath('overseer-control-memory.json');
const MAX_SLOT_LEN = 180;
const MAX_NOTE_LEN = 220;
const MAX_EVENT_LEN = 180;
const MAX_EVENTS = 20;
const MAX_NOTES = 24;

function createDefaultMemory() {
  return {
    version: 2,
    updatedAt: Date.now(),
    slots: ['', '', ''],
    notes: {},
    events: [],
  };
}

function sanitizeSlots(slots) {
  const next = Array.isArray(slots) ? slots.slice(0, 3) : [];
  while (next.length < 3) next.push('');
  return next.map((entry) => String(entry || '').trim().slice(0, MAX_SLOT_LEN));
}

function sanitizeNotes(notes) {
  const input = notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  const entries = Object.entries(input)
    .map(([key, value]) => [String(key || '').trim().slice(0, 48), String(value || '').trim().slice(0, MAX_NOTE_LEN)])
    .filter(([key, value]) => key && value)
    .slice(0, MAX_NOTES);
  return Object.fromEntries(entries);
}

function sanitizeEvents(events) {
  const input = Array.isArray(events) ? events : [];
  return input
    .slice(-MAX_EVENTS)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const text = String(entry.text || '').trim().slice(0, MAX_EVENT_LEN);
      if (!text) return null;
      const tags = Array.isArray(entry.tags)
        ? entry.tags.map((tag) => String(tag || '').trim().toLowerCase().slice(0, 20)).filter(Boolean).slice(0, 6)
        : [];
      const at = Number(entry.at) || Date.now();
      return { at, text, tags };
    })
    .filter(Boolean);
}

function sanitizeMemory(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultMemory();
  if (Array.isArray(raw?.slots) || Array.isArray(raw)) {
    const slots = sanitizeSlots(Array.isArray(raw) ? raw : raw.slots);
    return {
      version: 2,
      updatedAt: Date.now(),
      slots,
      notes: sanitizeNotes(raw?.notes),
      events: sanitizeEvents(raw?.events),
    };
  }
  return {
    version: 2,
    updatedAt: Number(raw.updatedAt) || Date.now(),
    slots: sanitizeSlots(raw.slots),
    notes: sanitizeNotes(raw.notes),
    events: sanitizeEvents(raw.events),
  };
}

function loadMemory() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return sanitizeMemory(raw);
  } catch {
    return createDefaultMemory();
  }
}

function saveMemory(memory) {
  const next = sanitizeMemory(memory);
  const payload = { ...next, updatedAt: Date.now() };
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function summarizeMemory(memory) {
  const safe = sanitizeMemory(memory);
  const lines = [];
  lines.push('memory_slots:');
  safe.slots.forEach((slot, idx) => lines.push(`- slot_${idx + 1}: ${slot || '(empty)'}`));
  const noteEntries = Object.entries(safe.notes);
  lines.push('memory_notes:');
  if (!noteEntries.length) lines.push('- (none)');
  noteEntries.slice(0, 10).forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
  lines.push('memory_events_recent:');
  if (!safe.events.length) lines.push('- (none)');
  safe.events
    .slice(-5)
    .forEach((evt) => lines.push(`- ${new Date(evt.at).toISOString()} | ${evt.tags.join(',') || 'misc'} | ${evt.text}`));
  return lines.join('\n');
}

module.exports = {
  loadMemory,
  saveMemory,
  createDefaultMemory,
  summarizeMemory,
};
