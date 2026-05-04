module.exports = {
  id: 'memory_event_add',
  signature: 'memory_event_add(text, tags?)',
  description: 'Append a short recent-event memory with optional tags.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 180 },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 20 },
        minItems: 0,
        maxItems: 6,
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ args = {}, memoryStore }) {
    const text = String(args?.text || '').trim().slice(0, 180);
    if (!text) throw new Error('memory_event_add requires args.text');
    const tags = Array.isArray(args?.tags)
      ? args.tags.map((tag) => String(tag || '').trim().toLowerCase().slice(0, 20)).filter(Boolean).slice(0, 6)
      : [];
    const next = memoryStore && typeof memoryStore === 'object' ? { ...memoryStore } : {};
    const events = Array.isArray(next.events) ? [...next.events] : [];
    events.push({ at: Date.now(), text, tags });
    next.events = events.slice(-20);
    return { ok: true, memory: next };
  },
};
