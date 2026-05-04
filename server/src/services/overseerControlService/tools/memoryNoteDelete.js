module.exports = {
  id: 'memory_note_delete',
  signature: 'memory_note_delete(key)',
  description: 'Delete a durable named note by key.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', minLength: 1, maxLength: 48 },
    },
    required: ['key'],
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ args = {}, memoryStore }) {
    const key = String(args?.key || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_').slice(0, 48);
    if (!key) throw new Error('memory_note_delete requires args.key');
    const next = memoryStore && typeof memoryStore === 'object' ? { ...memoryStore } : {};
    const notes = next.notes && typeof next.notes === 'object' && !Array.isArray(next.notes) ? { ...next.notes } : {};
    delete notes[key];
    next.notes = notes;
    return { ok: true, memory: next, key };
  },
};
