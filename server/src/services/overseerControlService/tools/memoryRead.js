module.exports = {
  id: 'memory_read',
  signature: 'memory_read()',
  description: 'Read the Overseer persistent 3-slot memory.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ memoryStore }) {
    return { ok: true, slots: memoryStore || ['', '', ''] };
  },
};
