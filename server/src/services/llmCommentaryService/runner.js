// llm Commentary Service runner
// Purpose: Owns commentary tick scheduling, generation loop, and runtime-history reset behavior.
// Scope: Keeps runtime behavior unchanged by operating on injected mutable runtime state and callbacks.
function createRunner(deps) {
  const {
    logger,
    enabled,
    model,
    ollamaUrl,
    frequencyMs,
    jitterMs,
    postCooldownMs,
    maxBotMessages,
    runtime,
    snapshotEngine,
    readSystemPrompt,
    buildModelMessages,
    generateCommentary,
    normalizeDuplicateKey,
    getRecentMessages,
    sendSystemMessage,
    buildFailureInfo,
    updatePhase,
    startRunRecord,
    patchCurrentRun,
    finalizeRunRecord,
    updateStatus,
  } = deps;

  function defaultTickDelayMs() {
    return frequencyMs + Math.floor(Math.random() * (jitterMs + 1));
  }

  function scheduleNextTick(runTick, delayMs = defaultTickDelayMs()) {
    const safeDelay = Math.max(0, Number.isFinite(delayMs) ? Math.floor(delayMs) : defaultTickDelayMs());
    const nextRunAt = Date.now() + safeDelay;
    updateStatus({ nextRunAt });
    runtime.timer = setTimeout(runTick, safeDelay);
  }

  function wakeForDriverActivity(runTick) {
    if (runtime.inFlight) return;
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    scheduleNextTick(runTick, 0);
  }

  function stop(reason = 'stopped') {
    if (runtime.timer) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    updatePhase('paused', {
      running: false,
      inFlight: false,
      currentRunId: null,
      nextRunAt: null,
      lastOutcome: 'paused',
      lastReason: reason,
    });
  }

  function clearRuntimeHistory() {
    runtime.contextResetAt = Date.now();
    runtime.clearCount += 1;
    runtime.skipStreak = 0;
    runtime.generationCount = 0;
    runtime.generationTotalMs = 0;
    runtime.runHistory = [];
    runtime.currentRun = null;
    snapshotEngine.resetHistory();
    updateStatus({
      lastClearedAt: runtime.contextResetAt,
      clearCount: runtime.clearCount,
      skipStreak: runtime.skipStreak,
      phase: 'idle',
      phaseAt: Date.now(),
      currentRunId: null,
      lastGenerationMs: null,
      avgGenerationMs: null,
      generationCount: runtime.generationCount,
      lastInfoSnapshot: null,
      lastModelMessages: null,
      lastModelInputAt: null,
      lastModelInputTickId: null,
      lastModelRawOutput: null,
      lastModelOutputAt: null,
      lastModelOutputTickId: null,
      lastSnapshotSummary: null,
      lastGeneratedText: null,
      lastPostedText: null,
      lastPostedAt: null,
      lastError: null,
      lastErrorDetails: null,
      lastFailedAt: null,
      lastOutcome: 'cleared',
      lastReason: 'admin requested clear history',
    });
  }

  async function runTick() {
    let nextDelayMs = defaultTickDelayMs();
    runtime.tickCount += 1;
    const tickId = runtime.tickCount;
    updatePhase('tick_started', {
      tickCount: runtime.tickCount,
      inFlight: true,
      currentRunId: tickId,
      lastTickAt: Date.now(),
      lastError: null,
      lastErrorDetails: null,
    });
    if (runtime.inFlight) {
      logger.info('Commentary tick skipped; previous tick still running', { tickId });
      updatePhase('idle', {
        inFlight: false,
        currentRunId: null,
        lastOutcome: 'skipped',
        lastReason: 'previous tick still running',
      });
      scheduleNextTick(runTick, nextDelayMs);
      return;
    }
    runtime.inFlight = true;
    try {
      const snapshot = snapshotEngine.buildSnapshot();
      const snapshotSummary = {
        activeDrivers: snapshot?.run_meta?.active_driver_count || 0,
        rovers: snapshot?.current_snapshot?.rovers?.length || 0,
        chatMessages: (snapshot?.event_stream || []).filter((event) => event?.type === 'chat').length,
        drivingRovers: snapshot?.run_meta?.driving_rovers || [],
        eventCount: snapshot?.event_stream?.length || 0,
      };
      logger.info('Commentary tick started', {
        tickId,
        ...snapshotSummary,
      });
      startRunRecord(tickId, snapshotSummary);
      patchCurrentRun({
        phase: 'snapshot_ready',
        summary: snapshotSummary,
        input: {
          ...(runtime.currentRun?.input || {}),
          infoSnapshot: snapshot,
        },
      });
      updatePhase('snapshot_ready', {
        lastSnapshotSummary: snapshotSummary,
        lastInfoSnapshot: snapshot,
      });
      const systemPrompt = await readSystemPrompt();
      const snapshotForSend = snapshotEngine.refreshFinalSnapshotForSend(snapshot);
      const modelMessages = buildModelMessages(systemPrompt, snapshotForSend);
      const modelInputAt = Date.now();
      patchCurrentRun({
        phase: 'input_ready',
        input: {
          ...(runtime.currentRun?.input || {}),
          systemPrompt,
          infoSnapshot: snapshotForSend,
          modelMessages,
          modelInputAt,
        },
      });
      updatePhase('awaiting_model_output', {
        lastModelMessages: modelMessages,
        lastModelInputAt: modelInputAt,
        lastModelInputTickId: tickId,
        lastInfoSnapshot: snapshotForSend,
        lastModelRawOutput: null,
        lastModelOutputAt: null,
        lastModelOutputTickId: null,
        lastReason: 'awaiting model output',
      });
      const generationStartMs = Date.now();
      const modelResult = await generateCommentary(modelMessages);
      const generationMs = Math.max(0, Date.now() - generationStartMs);
      runtime.generationCount += 1;
      runtime.generationTotalMs += generationMs;
      const avgGenerationMs = Math.round(runtime.generationTotalMs / runtime.generationCount);
      const modelOutputAt = Date.now();
      patchCurrentRun({
        phase: 'output_received',
        output: {
          ...(runtime.currentRun?.output || {}),
          raw: modelResult?.raw || '',
          normalized: modelResult?.normalized || null,
          modelOutputAt,
        },
      });
      updatePhase('output_received', {
        lastModelRawOutput: modelResult?.raw || '',
        lastModelOutputAt: modelOutputAt,
        lastModelOutputTickId: tickId,
        lastGenerationMs: generationMs,
        avgGenerationMs,
        generationCount: runtime.generationCount,
      });
      const text = modelResult?.normalized;
      if (!text) {
        logger.info('Commentary tick produced SKIP/empty output', { tickId });
        runtime.skipStreak += 1;
        patchCurrentRun({
          phase: 'decision_skip',
          outcome: 'skipped',
          reason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
        });
        updatePhase('decision_skip', {
          lastOutcome: 'skipped',
          lastReason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
          skipStreak: runtime.skipStreak,
          lastGeneratedText: null,
        });
        finalizeRunRecord({
          outcome: 'skipped',
          reason: modelResult?.raw?.trim() ? 'model returned SKIP' : 'model returned empty',
        });
        nextDelayMs = 0;
        return;
      }
      updatePhase('decision_post', { lastGeneratedText: text });
      const recentBotMessages = getRecentMessages(120, { includeSystem: true })
        .filter((entry) => Number(entry?.ts) >= runtime.contextResetAt)
        .filter((entry) => entry?.bot)
        .slice(-Math.max(3, maxBotMessages));
      const duplicateKey = normalizeDuplicateKey(text);
      const duplicate = recentBotMessages.some(
        (entry) => normalizeDuplicateKey(entry?.text) === duplicateKey,
      );
      if (duplicate) {
        logger.info('Commentary tick skipped duplicate output', { tickId, text });
        runtime.skipStreak += 1;
        patchCurrentRun({
          phase: 'decision_skip',
          outcome: 'skipped',
          reason: 'duplicate text',
        });
        updatePhase('decision_skip', {
          lastOutcome: 'skipped',
          lastReason: 'duplicate text',
          skipStreak: runtime.skipStreak,
        });
        finalizeRunRecord({
          outcome: 'skipped',
          reason: 'duplicate text',
        });
        nextDelayMs = 0;
        return;
      }
      sendSystemMessage(text);
      logger.info('Commentary message posted', { tickId, text });
      runtime.skipStreak = 0;
      patchCurrentRun({
        phase: 'posted',
        outcome: 'posted',
        reason: null,
        output: {
          ...(runtime.currentRun?.output || {}),
          posted: text,
          postedAt: Date.now(),
        },
      });
      updatePhase('posted', {
        lastOutcome: 'posted',
        lastReason: null,
        skipStreak: runtime.skipStreak,
        lastPostedText: text,
        lastPostedAt: Date.now(),
      });
      nextDelayMs = Math.max(nextDelayMs, postCooldownMs);
      finalizeRunRecord({
        outcome: 'posted',
        reason: null,
      });
    } catch (err) {
      const failure = buildFailureInfo(err);
      logger.warn('Commentary tick failed', {
        tickId,
        reason: failure.reason,
        error: failure.message,
        details: failure.details,
      });
      patchCurrentRun({
        phase: 'failed',
        outcome: 'failed',
        reason: failure.reason,
        errors: {
          message: failure.message,
          details: failure.details,
        },
      });
      updatePhase('failed', {
        lastOutcome: 'failed',
        lastReason: failure.reason,
        lastError: failure.message,
        lastErrorDetails: failure.details,
        lastFailedAt: Date.now(),
      });
      finalizeRunRecord({
        outcome: 'failed',
        reason: failure.reason,
        errors: {
          message: failure.message,
          details: failure.details,
        },
      });
    } finally {
      runtime.inFlight = false;
      updatePhase('idle', {
        inFlight: false,
        currentRunId: null,
      });
      scheduleNextTick(runTick, nextDelayMs);
    }
  }

  function start() {
    if (!enabled) {
      logger.info('LLM commentary disabled');
      updatePhase('disabled', {
        running: false,
        lastOutcome: 'disabled',
        lastReason: 'llmCommentary.enabled is false',
      });
      return;
    }
    if (!model || !ollamaUrl) {
      logger.warn('LLM commentary disabled; model or ollamaUrl missing');
      updatePhase('disabled', {
        running: false,
        lastOutcome: 'disabled',
        lastReason: 'model or ollama server missing',
      });
      return;
    }
    logger.info('LLM commentary enabled', { model, ollamaUrl, frequencyMs });
    updatePhase('idle', {
      running: true,
      lastOutcome: 'running',
      lastReason: null,
    });
    runTick();
  }

  return {
    start,
    stop,
    runTick,
    clearRuntimeHistory,
    wakeForDriverActivity: () => wakeForDriverActivity(runTick),
  };
}

module.exports = {
  createRunner,
};
