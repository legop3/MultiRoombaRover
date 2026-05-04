module.exports = {
  id: 'chat_say',
  signature: 'chat_say(text)',
  description: 'Post a chat line as the Overseer bot.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 220 },
    },
    required: ['text'],
    additionalProperties: false,
  },
  availability() {
    return { available: true, reason: null };
  },
  async execute({ args = {}, sendSystemMessage, name }) {
    const text = String(args?.text || '').trim();
    if (!text) throw new Error('chat_say requires args.text');
    sendSystemMessage(text, { nickname: name });
    return { ok: true };
  },
};
