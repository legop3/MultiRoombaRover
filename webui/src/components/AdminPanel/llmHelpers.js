// llm Helpers
// Purpose: Defines the llm Helpers module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export function buildLlmLargeIndicatorFromState(state) {
  const runtime = state?.runtime || {};
  const output = state?.output || {};
  const errors = state?.errors || {};
  if (runtime.inFlight) {
    return {
      label: 'IN FLIGHT',
      detail: runtime.reason || 'Generating commentary now',
      className: 'border-amber-400/60 bg-amber-700/20 text-amber-200',
    };
  }
  if (runtime.outcome === 'posted') {
    return {
      label: 'POSTED',
      detail: output.posted ? `Last: ${output.posted}` : 'Commentary posted',
      className: 'border-emerald-400/60 bg-emerald-700/20 text-emerald-200',
    };
  }
  if (runtime.outcome === 'skipped') {
    return {
      label: 'SKIPPED',
      detail: runtime.reason || 'Model chose to skip',
      className: 'border-slate-400/60 bg-slate-700/30 text-slate-200',
    };
  }
  if (runtime.outcome === 'failed') {
    return {
      label: 'FAILED',
      detail: errors.message || runtime.reason || 'Tick failed',
      className: 'border-red-400/60 bg-red-700/20 text-red-200',
    };
  }
  return {
    label: runtime.running ? 'IDLE' : 'STOPPED',
    detail: runtime.reason || 'Waiting for next tick',
    className: 'border-sky-400/50 bg-sky-700/20 text-sky-200',
  };
}

export function buildLlmConversationRowsFromMessages(modelMessages, rawOutput) {
  const now = Date.now();
  const messages = Array.isArray(modelMessages) ? modelMessages : [];
  const rows = messages.map((entry, index) => {
    const role = String(entry?.role || '').toLowerCase();
    const content =
      typeof entry?.content === 'string' ? entry.content : JSON.stringify(entry?.content ?? null, null, 2);
    const nickname =
      role === 'system'
        ? 'LLM System'
        : role === 'assistant'
        ? 'LLM Context'
        : role === 'user'
        ? 'LLM Input'
        : 'LLM Message';
    return {
      id: `llm-msg-${index}`,
      message: {
        ts: now + index,
        nickname,
        text: content,
        role: 'spectator',
        bot: role === 'system',
      },
    };
  });
  if (rawOutput != null) {
    const raw = String(rawOutput);
    rows.push({
      id: 'llm-output',
      message: {
        ts: now + rows.length + 1,
        nickname: 'LLM Output',
        text: raw.trim() ? raw : '<empty>',
        role: 'spectator',
        bot: true,
      },
    });
  }
  return rows;
}
