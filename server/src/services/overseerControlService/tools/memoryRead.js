module.exports = {
  id: 'memory_read',
  signature: 'memory_read()',
  availability() {
    return { available: true, reason: null };
  },
  async execute({ memoryStore }) {
    return { ok: true, slots: memoryStore || ['', '', ''] };
  },
};
