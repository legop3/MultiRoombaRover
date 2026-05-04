module.exports = {
  id: 'memory_read',
  signature: 'memory_read()',
  description: 'Read full persistent memory (slots, notes, recent events).',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ memoryStore }) {
    return { ok: true, memory: memoryStore };
  },
};
