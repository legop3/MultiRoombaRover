// llm Commentary Service runtime helpers
// Purpose: Provides pure helpers for admin state projection, role checks, and structured error normalization.
// Scope: Keeps runtime behavior unchanged by extracting deterministic helper logic from index orchestration.
function isAdminRole(role) {
  return role === 'admin' || role === 'lockdown';
}

function buildAdminState(status, runHistory) {
  return {
    runtime: {
      running: status.running,
      inFlight: status.inFlight,
      phase: status.phase,
      phaseAt: status.phaseAt,
      currentRunId: status.currentRunId,
      tickCount: status.tickCount,
      lastTickAt: status.lastTickAt,
      nextRunAt: status.nextRunAt,
      outcome: status.lastOutcome,
      reason: status.lastReason,
    },
    counters: {
      clearCount: status.clearCount,
      skipStreak: status.skipStreak,
      promptChars: status.lastPromptChars,
      snapshotSummary: status.lastSnapshotSummary,
    },
    timings: {
      lastGenerationMs: status.lastGenerationMs,
      avgGenerationMs: status.avgGenerationMs,
      generationCount: status.generationCount,
    },
    input: {
      promptPath: status.promptPath,
      systemPrompt: status.lastSystemPrompt,
      infoSnapshot: status.lastInfoSnapshot,
      modelMessages: status.lastModelMessages,
      modelInputAt: status.lastModelInputAt,
      modelInputTickId: status.lastModelInputTickId,
    },
    output: {
      raw: status.lastModelRawOutput,
      generated: status.lastGeneratedText,
      posted: status.lastPostedText,
      postedAt: status.lastPostedAt,
      modelOutputAt: status.lastModelOutputAt,
      modelOutputTickId: status.lastModelOutputTickId,
    },
    errors: {
      message: status.lastError,
      details: status.lastErrorDetails,
      failedAt: status.lastFailedAt,
    },
    history: runHistory,
    debug: {
      status,
    },
    controls: {
      supportedActions: ['clearHistory'],
    },
  };
}

function buildFailureInfo(err) {
  const details = {};
  if (err && typeof err === 'object') {
    if (err.name) details.name = String(err.name);
    if (err.code != null) details.code = String(err.code);
    if (err.errno != null) details.errno = String(err.errno);
    if (err.type) details.type = String(err.type);
    if (err.status != null) details.status = Number(err.status);
    if (err.statusCode != null) details.statusCode = Number(err.statusCode);
    if (err.status_code != null) details.status_code = Number(err.status_code);
    if (err.error) details.error = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
    if (err.cause) {
      if (typeof err.cause === 'string') {
        details.cause = err.cause;
      } else if (typeof err.cause === 'object') {
        details.cause = {
          name: err.cause.name || null,
          message: err.cause.message || null,
          code: err.cause.code || null,
          status: err.cause.status ?? err.cause.statusCode ?? null,
        };
      }
    }
    if (err.response && typeof err.response === 'object') {
      const response = {};
      if (err.response.status != null) response.status = Number(err.response.status);
      if (err.response.statusText) response.statusText = String(err.response.statusText);
      if (err.response.url) response.url = String(err.response.url);
      if (Object.keys(response).length) {
        details.response = response;
      }
    }
  }

  const message =
    (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) ||
    details.error ||
    String(err || 'Unknown error');

  const reasonParts = [];
  if (details.name) reasonParts.push(details.name);
  const code = details.code || details.errno || details.type;
  if (code) reasonParts.push(String(code));
  const status =
    details.status ??
    details.statusCode ??
    details.status_code ??
    details.response?.status ??
    null;
  if (status != null) reasonParts.push(`status ${status}`);
  const reason = reasonParts.length ? reasonParts.join(' | ') : 'exception';

  return { reason, message, details: Object.keys(details).length ? details : null };
}

module.exports = {
  isAdminRole,
  buildAdminState,
  buildFailureInfo,
};
