function isAdminRole(role) {
  return role === 'admin' || role === 'lockdown';
}

function buildAdminState(status, runHistory) {
  return {
    runtime: {
      running: status.running,
      phase: status.phase,
      phaseAt: status.phaseAt,
      inFlight: status.inFlight,
      tickCount: status.tickCount,
      currentRunId: status.currentRunId,
      lastTriggerReason: status.lastTriggerReason,
      nextRunAt: status.nextRunAt,
      lastTickAt: status.lastTickAt,
    },
    config: {
      enabled: status.enabled,
      name: status.name,
      model: status.model,
      ollamaUrl: status.ollamaUrl,
      gateIntervalMs: status.gateIntervalMs,
      heartbeatMs: status.heartbeatMs,
      alwaysRunModel: status.alwaysRunModel,
      observeOnly: status.observeOnly,
      promptPath: status.promptPath,
    },
    input: {
      systemPrompt: status.lastSystemPrompt,
      stateUpdate: status.lastStateUpdate,
      transcript: status.lastTranscript,
      availableTools: status.lastAvailableTools,
      blockedTools: status.lastBlockedTools,
      modelMessages: status.lastModelMessages,
      modelInputAt: status.lastModelInputAt,
    },
    output: {
      raw: status.lastModelRawOutput,
      normalized: status.lastDecision,
      chat: status.lastChatDraft,
      actions: status.lastRequestedActions,
      actionResults: status.lastActionResults,
      liveToolCalls: status.lastLiveToolCalls || [],
      outputAt: status.lastModelOutputAt,
      outcome: status.lastOutcome,
      reason: status.lastReason,
    },
    timings: {
      lastGenerationMs: status.lastGenerationMs,
      avgGenerationMs: status.avgGenerationMs,
      generationCount: status.generationCount,
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
  const message = err?.message || String(err || 'Unknown error');
  const details = {
    name: err?.name || null,
    code: err?.code || null,
  };
  return {
    message,
    details,
  };
}

module.exports = {
  isAdminRole,
  buildAdminState,
  buildFailureInfo,
};
