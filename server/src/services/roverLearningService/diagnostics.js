// Export an explicit allowlist, never the raw socket/session/configuration object.
const { redact } = require('./errors');
const { POLICY_VERSION } = require('./capabilities');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const applicationVersion = require('../../../package.json').version;
const hash = createHash('sha256');
for (const file of ['workers/policy.py', 'workers/dataset.py', 'workers/train.py', 'workers/infer.py', 'workers/observations.py', 'workers/learning.py',
  'capabilities.js', 'errors.js', 'storage.js', 'runtime.js', 'models.js', 'driving.js', 'recording.js', 'training.js', 'socketGateway.js', 'diagnostics.js']) {
  hash.update(fs.readFileSync(path.join(__dirname, file)));
}
const implementationSha256 = hash.digest('hex');

function errorCategory(value) {
  if (!value) return null;
  const text = String(value).toLowerCase();
  for (const [pattern, category] of [
    [/timestamp|pts|clock|aligned/, 'time_alignment'], [/sensor/, 'sensors'],
    [/video|decode|ffmpeg|rtsp/, 'video'], [/permission|turn|control permission/, 'permission'],
    [/schema|shape|version/, 'model_schema'], [/space|disk|enospc/, 'storage'],
    [/sample|window|command/, 'dataset_or_command'], [/worker|exited|process/, 'worker'],
  ]) if (pattern.test(text)) return category;
  return 'unclassified';
}

function report(state, controller) {
  const training = state.training || {};
  const metrics = training.diagnostics || {};
  const session = state.session;
  return {
    reportVersion: 3, generatedAtUnixMs: state.updatedAt,
    software: { applicationVersion, implementationSha256, policyVersion: POLICY_VERSION, node: process.version,
      dependencies: metrics.dependencies || null },
    host: { logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), loadAverage: os.loadavg() },
    settings: state.limits,
    recording: { paused: state.recording.paused, bytes: state.recording.bytes,
      freeBytes: state.recording.freeBytes, pendingBytes: state.recording.pendingBytes,
      droppedPending: state.recording.droppedPending,
      sessions: state.recording.sessions.map((item) => ({ startedAtUnixMs: item.startedAt,
        status: item.video, droppedEvents: item.droppedEvents, error: redact(item.error), failureDetails: item.failureDetails || null, stderr: redact(item.stderr), errorCategory: errorCategory(item.error) })) },
    training: { status: training.status, steps: training.steps, examples: training.examples,
      selection: training.selection || null, evaluatedSteps: training.evaluatedSteps ?? null,
      loss: training.loss, losses: training.losses || null, publication: training.publication || null,
      trainingAudit: metrics.trainingAudit || null,
      evaluation: training.evaluation || null, dataset: metrics.dataset || training.dataset || null,
      resources: { decodeSeconds: metrics.decodeSeconds ?? null, trainingSeconds: metrics.trainingSeconds ?? null,
        evaluationSeconds: metrics.evaluationSeconds ?? null, probeSeconds: metrics.probeSeconds ?? null, beforeAuditSeconds: metrics.beforeAuditSeconds ?? null, checkpointSeconds: metrics.checkpointSeconds ?? null, cpuSeconds: metrics.cpuSeconds ?? null,
        peakRssMiB: metrics.peakRssMiB ?? null },
      history: training.history || [], rejectionReasons: (training.rejectionReasons || []).map(redact), rejectionCategories: (training.rejectionReasons || []).map(errorCategory),
      error: redact(training.error), errorCategory: errorCategory(training.error), nextAttemptAtUnixMs: training.nextAttemptAt },
    model: session ? { id: session.modelId, checkpointId: session.checkpointId, threshold: session.threshold, appliedThreshold: session.appliedThreshold } : null,
    controller: controller ? { modelId: controller.modelId, sensorPresent: controller.sensorPresent || null,
      stopReason: redact(controller.stopReason), stopCategory: errorCategory(controller.stopReason), history: (controller.history || []).map((item) => ({
        ...item, submissions: item.submissions.map((submission) => ({ type: submission.type,
          command: submission.command, result: redact(submission.result) })) })) } : null,
    sensorFields: metrics.policy?.sensorFields || null,
    timing: { alignment: 'server_receipt', browserVideoLatencyMs: null, wheelCommandExpiryMs: null },
    events: state.activity.map(({ at, message, detail, error, stderr }) => ({ atUnixMs: at, message: redact(message), detail: redact(detail), error: error || null, stderr: redact(stderr) })),
    unavailable: ['browser_video_latency', 'actual_physical_command_execution', 'live_training_cpu_utilization'],
  };
}
module.exports = { report };
