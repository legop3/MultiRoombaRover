module.exports = {
  id: 'memory_write',
  signature: 'memory_write(slot, text)',
  description: 'Write one of 3 Overseer memory slots.',
  parameters: {
    type: 'object',
    properties: {
      slot: { type: 'integer', minimum: 1, maximum: 3 },
      text: { type: 'string', minLength: 1, maxLength: 180 },
    },
    required: ['slot', 'text'],
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ args = {}, memoryStore }) {
    const slot = Math.max(1, Math.min(3, Number(args?.slot) || 0));
    if (!slot) throw new Error('memory_write requires args.slot 1..3');
    const text = String(args?.text || '').trim();
    if (!text) throw new Error('memory_write requires args.text');
    const next = Array.isArray(memoryStore) ? [...memoryStore] : ['', '', ''];
    while (next.length < 3) next.push('');
    next[slot - 1] = text.slice(0, 180);
    return { ok: true, slots: next };
  },
};
