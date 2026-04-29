// llm Commentary Service formatters
// Purpose: Encodes snapshot/chat/event structures into stable model-facing prompt message text.
// Scope: Keeps runtime behavior unchanged by extracting pure text-formatting and normalization helpers.
function normalizeCommentary(rawText) {
  if (typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  if (/\bSKIP\b/i.test(trimmed)) return null;
  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  if (/\bSKIP\b/i.test(firstLine)) return null;
  return firstLine.replace(/\s+/g, ' ');
}

function parseModelOutput(rawContent) {
  const raw = typeof rawContent === 'string' ? rawContent : '';
  const normalized = normalizeCommentary(raw);
  return {
    raw,
    normalized,
    skipped: normalized == null,
  };
}

function normalizeDuplicateKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function encBool(value) {
  return value ? '1' : '0';
}

function encStatus(value) {
  const map = {
    charging: 'charging',
    docked: 'docked',
    driving: 'driving',
    'active-idle': 'active_idle',
    idle: 'idle',
    unknown: 'unknown',
  };
  return map[String(value || 'unknown')] || 'unknown';
}

function encActivityBand(value) {
  const map = {
    idle: 'idle',
    low: 'low',
    medium: 'medium',
    high: 'high',
    intense: 'intense',
  };
  return map[String(value || 'idle')] || 'idle';
}

function encActivityTrend(value) {
  const map = {
    rising: 'rising',
    steady: 'steady',
    falling: 'falling',
  };
  return map[String(value || 'steady')] || 'steady';
}

function formatChatRoverCtx(ctx) {
  if (!ctx || typeof ctx !== 'object') return 'none';
  return `st=${encStatus(ctx.status_tag)} bl=${encBool(Boolean(ctx.battery_low))} dk=${encBool(Boolean(ctx.docked))} ab=${encActivityBand(ctx.activity_band)} at=${encActivityTrend(ctx.activity_trend)}`;
}

function formatChatEventMessage(event) {
  const roverId = event.rover_id || 'none';
  if (roverId === 'none') {
    return [
      'CHAT',
      `n=${event.nickname || 'unknown'} r=none driver=none`,
      `txt: ${event.text || ''}`,
    ].join('\n');
  }
  return [
    'CHAT',
    `n=${event.nickname || 'unknown'} r=${roverId}`,
    `txt: ${event.text || ''}`,
    `rn: ${formatChatRoverCtx(event.rover_ctx)}`,
  ].join('\n');
}

function formatRoverSnapshotLine(rover = {}) {
  return `id=${rover.id || 'unknown'} drv=${rover.driver_nickname || 'none'} st=${encStatus(rover.status_tag)} bl=${encBool(Boolean(rover.battery_low))} dk=${encBool(Boolean(rover.docked))} as=${Number(rover.activity_score) || 0} ab=${encActivityBand(rover.activity_band)} at=${encActivityTrend(rover.activity_trend)}`;
}

function formatEventMessage(event) {
  return [
    'EVENT',
    `e=${event.event_type || 'rover_event'} r=${event.rover_id || 'unknown'} d=${event.driver_nickname || 'none'}`,
    `s: ${event.summary || ''}`,
  ].join('\n');
}

function formatSnapshotMessage(event) {
  const rovers = Array.isArray(event?.rovers) ? event.rovers : [];
  const lines = ['SNAPSHOT', `reason=${event?.reason || 'none'}`];
  rovers.forEach((rover) => {
    lines.push(formatRoverSnapshotLine(rover));
  });
  return lines.join('\n');
}

function formatSnapshotFinalMessage(currentSnapshot = {}, runMeta = {}) {
  const rovers = Array.isArray(currentSnapshot?.rovers) ? currentSnapshot.rovers : [];
  const lines = ['SNAPSHOT FINAL'];
  lines.push(`skip_streak=${Number(runMeta?.skip_streak) || 0}`);
  rovers.forEach((rover) => {
    lines.push(formatRoverSnapshotLine(rover));
  });
  if (Array.isArray(currentSnapshot?.chat_recent) && currentSnapshot.chat_recent.length) {
    lines.push('chat_recent:');
    currentSnapshot.chat_recent.forEach((entry) => {
      lines.push(`- ${entry.nickname || 'unknown'}: ${entry.text || ''}`);
    });
  }
  return lines.join('\n');
}

function buildModelMessages(systemPrompt, snapshot) {
  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });
  const timeline = Array.isArray(snapshot?.event_stream) ? snapshot.event_stream : [];
  timeline.forEach((event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'bot') {
      const text = String(event.text || '').trim();
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      return;
    }
    if (event.type === 'chat') {
      messages.push({
        role: 'user',
        content: formatChatEventMessage(event),
      });
      return;
    }
    if (event.type === 'event') {
      messages.push({
        role: 'user',
        content: formatEventMessage(event),
      });
      return;
    }
    if (event.type === 'snapshot') {
      messages.push({
        role: 'user',
        content: formatSnapshotMessage(event),
      });
    }
  });
  // Always end with a full rover snapshot user message.
  messages.push({
    role: 'user',
    content: formatSnapshotFinalMessage(snapshot?.current_snapshot || {}, snapshot?.run_meta || {}),
  });
  return messages;
}

module.exports = {
  normalizeCommentary,
  parseModelOutput,
  normalizeDuplicateKey,
  buildModelMessages,
};
