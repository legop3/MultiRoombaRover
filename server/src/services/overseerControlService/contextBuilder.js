const { evaluateTools } = require('./tools');

function toStateUpdate({ mode, homeAssistantState, neatoState, liftState, roster, triggerReason }) {
  const lines = [];
  lines.push(`trigger: ${triggerReason || 'heartbeat'}`);
  lines.push(`mode: ${mode || 'unknown'}`);
  lines.push(`home_assistant_connected: ${homeAssistantState?.connected ? 'yes' : 'no'}`);
  lines.push(`lights_locked_on: ${homeAssistantState?.lightPolicy?.lockedOn ? 'yes' : 'no'}`);
  lines.push(`lift: ${liftState?.connected ? 'connected' : 'offline'} busy=${liftState?.busy ? 'yes' : 'no'}`);
  lines.push(`neato: ${neatoState?.connected ? 'connected' : 'offline'} state=${neatoState?.telemetry?.robotState || 'unknown'}`);
  const roverLines = (Array.isArray(roster) ? roster : []).slice(0, 6).map((rover) => {
    const roverId = rover?.id || 'unknown';
    const driver = rover?.driverNickname || 'none';
    const status = rover?.statusTag || 'unknown';
    return `- ${roverId} status=${status} driver=${driver}`;
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
    const isAssistant = Boolean(entry?.bot || entry?.system);
    const nickname = String(entry?.nickname || (isAssistant ? name || 'Overseer' : 'user')).trim();
    if (isAssistant) {
      messages.push({ role: 'assistant', content: text });
      return;
    }
    messages.push({ role: 'user', content: `${nickname}: ${text}` });
  });
  return messages;
}

function buildModelMessages({ systemPrompt, stateUpdate, conversationMessages, availableTools, blockedTools }) {
  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: `STATE_UPDATE\n${stateUpdate}` });
  (conversationMessages || []).forEach((message) => {
    if (!message || !message.role || !message.content) return;
    messages.push(message);
  });
  messages.push({
    role: 'user',
    content: `available_tools:\n${availableTools.map((tool) => `- ${tool}`).join('\n') || '- none'}`,
  });
  messages.push({
    role: 'user',
    content: `blocked_tools:\n${blockedTools.map((entry) => `- ${entry.tool} reason=${entry.reason}`).join('\n') || '- none'}`,
  });
  messages.push({
    role: 'user',
    content:
      'Respond with JSON only: {"decision":"SKIP|CHAT|ACTION|ACTION+CHAT","chat":"optional text","actions":[{"tool":"tool_id","args":{}}]}. Use action tool ids only.',
  });
  return messages;
}

module.exports = {
  toStateUpdate,
  buildToolState,
  buildConversation,
  buildModelMessages,
};
