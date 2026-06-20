// Chat Command Result Formatter
// Purpose: Converts command reply payloads into readable web-chat text.
// Scope: Keeps web chat rendering local instead of routing command output through Discord bridge messages.

function normalizeText(value) {
  return String(value || '').trim();
}

function embedToText(embed) {
  const data = embed?.data || embed || {};
  const lines = [];
  if (data.title) lines.push(String(data.title));
  if (data.description) lines.push(String(data.description));
  (Array.isArray(data.fields) ? data.fields : []).forEach((field) => {
    if (!field) return;
    // Discord embeds are the main structured result shape produced by existing
    // commands. Web chat is plain text, so only flatten the human-readable
    // fields instead of preserving Discord presentation concerns.
    lines.push(`${field.name || 'Field'}\n${field.value || ''}`.trim());
  });
  if (data.footer?.text) lines.push(String(data.footer.text));
  return lines.map(normalizeText).filter(Boolean).join('\n\n');
}

function commandReplyToText(payload) {
  if (typeof payload === 'string') return normalizeText(payload);
  if (!payload || typeof payload !== 'object') return '';
  const parts = [];
  if (payload.content) parts.push(String(payload.content));
  (Array.isArray(payload.embeds) ? payload.embeds : []).forEach((embed) => {
    const text = embedToText(embed);
    if (text) parts.push(text);
  });
  (Array.isArray(payload.files) ? payload.files : []).forEach((file) => {
    const name = file?.name || file?.filename || 'attachment';
    parts.push(String(name));
  });
  return parts.map(normalizeText).filter(Boolean).join('\n\n');
}

module.exports = {
  commandReplyToText,
  embedToText,
};
