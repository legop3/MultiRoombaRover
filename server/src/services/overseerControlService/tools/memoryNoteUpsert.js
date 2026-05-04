module.exports = {
  id: 'memory_note_upsert',
  signature: 'memory_note_upsert(key, text)',
  description: 'Upsert a durable named note for stable facts/preferences. Key is short snake_case.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', minLength: 1, maxLength: 48 },
      text: { type: 'string', minLength: 1, maxLength: 220 },
    },
    required: ['key', 'text'],
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ args = {}, memoryStore }) {
    const key = String(args?.key || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_').slice(0, 48);
    const text = String(args?.text || '').trim().slice(0, 220);
    if (!key) throw new Error('memory_note_upsert requires args.key');
    if (!text) throw new Error('memory_note_upsert requires args.text');
    const next = memoryStore && typeof memoryStore === 'object' ? { ...memoryStore } : {};
    const notes = next.notes && typeof next.notes === 'object' && !Array.isArray(next.notes) ? { ...next.notes } : {};
    notes[key] = text;
    next.notes = notes;
    return { ok: true, memory: next, key };
  },
};
