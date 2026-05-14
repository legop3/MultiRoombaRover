const { evaluateTools } = require('./tools');

function normalizeNeatoIssue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'none';
  if (raw.includes('200')) return 'none';
  return raw;
}

function toStateUpdate({ mode, homeAssistantState, neatoState, liftState, roster, triggerReason }) {
  const lines = [];
  lines.push(`trigger: ${triggerReason || 'heartbeat'}`);
  lines.push(`mode: ${mode || 'unknown'}`);
  lines.push(`home_assistant_connected: ${homeAssistantState?.connected ? 'yes' : 'no'}`);
  lines.push(`lights_locked_on: ${homeAssistantState?.lightPolicy?.lockedOn ? 'yes' : 'no'}`);
  lines.push(`lift: ${liftState?.connected ? 'connected' : 'offline'} busy=${liftState?.busy ? 'yes' : 'no'}`);
  const neatoError = normalizeNeatoIssue(neatoState?.telemetry?.robotError);
  const neatoAlert = normalizeNeatoIssue(neatoState?.telemetry?.robotAlert);
  lines.push(
    `neato: ${neatoState?.connected ? 'connected' : 'offline'} state=${neatoState?.telemetry?.robotState || 'unknown'} error=${neatoError} alert=${neatoAlert}`,
  );
  const entities = Array.isArray(homeAssistantState?.entities) ? homeAssistantState.entities : [];
  if (entities.length) {
    lines.push('home_assistant_entities:');
    entities.slice(0, 24).forEach((entity) => {
      lines.push(`- ${entity.id} (${entity.type || 'entity'}) state=${entity.state || 'unknown'} available=${entity.available ? 'yes' : 'no'}`);
    });
  }
  const roverLines = (Array.isArray(roster) ? roster : []).slice(0, 6).map((rover) => {
    const roverId = rover?.id || 'unknown';
    const drivers = Array.isArray(rover?.drivers) ? rover.drivers.filter(Boolean) : [];
    const driver = drivers.length ? drivers.join(',') : 'none';
    const status = rover?.statusTag || 'unknown';
    return `- ${roverId} status=${status} drivers=${driver}`;
  });
  if (roverLines.length) {
    lines.push('rovers:');
    lines.push(...roverLines);
  }
  return lines.join('\n');
}

function buildToolState({ mode, homeAssistantState, neatoState, liftState }) {
  return evaluateTools({ mode, homeAssistantState, neatoState, liftState });
}

function buildConversation({ recentMessages, name }) {
  const messages = [];
  (recentMessages || []).forEach((entry) => {
    const text = String(entry?.text || '').trim();
    if (!text) return;
    const isAssistant = Boolean(entry?.bot);
    const nickname = String(entry?.nickname || (isAssistant ? name || 'Overseer' : 'user')).trim();
    if (isAssistant) {
      messages.push({ role: 'assistant', content: text });
      return;
    }
    messages.push({ role: 'user', content: `${nickname}: ${text}` });
  });
  return messages;
}

function buildModelMessages({ systemPrompt, stateUpdate, memorySummary, conversationMessages, availableTools, blockedTools }) {
  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });
  const metadataSections = [];
  metadataSections.push(`STATE_UPDATE\n${stateUpdate}`);
  if (memorySummary) metadataSections.push(`MEMORY_UPDATE\n${memorySummary}`);
  metadataSections.push(
    `tool_constraints:\n${blockedTools.map((entry) => `- blocked: ${entry.tool} reason=${entry.reason}`).join('\n') || '- none'}`,
  );
  messages.push({ role: 'user', content: metadataSections.join('\n\n') });
  (conversationMessages || []).forEach((message) => {
    if (!message || !message.role || !message.content) return;
    messages.push(message);
  });
  return messages;
}

module.exports = {
  toStateUpdate,
  buildToolState,
  buildConversation,
  buildModelMessages,
};
