// Export an explicit allowlist, never the raw socket/session/configuration object.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const applicationVersion = require('../../../package.json').version;
const hash = createHash('sha256');
for (const file of ['workers/policy.py', 'workers/dataset.py', 'workers/train.py', 'workers/infer.py',
  'driving.js', 'recording.js', 'training.js', 'socketGateway.js', 'diagnostics.js']) {
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
    reportVersion: 1, generatedAtUnixMs: state.updatedAt,
    software: { applicationVersion, implementationSha256, policyVersion: 2, node: process.version,
      dependencies: metrics.dependencies || null },
    host: { logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), loadAverage: os.loadavg() },
    settings: state.limits,
    recording: { paused: state.recording.paused, bytes: state.recording.bytes,
      freeBytes: state.recording.freeBytes, pendingBytes: state.recording.pendingBytes,
      droppedPending: state.recording.droppedPending,
      sessions: state.recording.sessions.map((item) => ({ startedAtUnixMs: item.startedAt,
        status: item.video, droppedEvents: item.droppedEvents, errorCategory: errorCategory(item.error) })) },
    training: { status: training.status, steps: training.steps, examples: training.examples,
      loss: training.loss, losses: training.losses || null, publication: training.publication || null,
      evaluation: training.evaluation || null, dataset: metrics.dataset || training.dataset || null,
      resources: { decodeSeconds: metrics.decodeSeconds ?? null, trainingSeconds: metrics.trainingSeconds ?? null,
        evaluationSeconds: metrics.evaluationSeconds ?? null, checkpointSeconds: metrics.checkpointSeconds ?? null, cpuSeconds: metrics.cpuSeconds ?? null,
        peakRssMiB: metrics.peakRssMiB ?? null },
      history: training.history || [], rejectionCategories: (training.rejectionReasons || []).map(errorCategory),
      errorCategory: errorCategory(training.error), nextAttemptAtUnixMs: training.nextAttemptAt },
    model: session ? { id: session.modelId, threshold: session.threshold, appliedThreshold: session.appliedThreshold } : null,
    controller: controller ? { modelId: controller.modelId, sensorPresent: controller.sensorPresent || null,
      stopCategory: errorCategory(controller.stopReason), history: (controller.history || []).map((item) => ({
        ...item, submissions: item.submissions.map((submission) => ({ type: submission.type,
          wheels: submission.wheels, result: submission.result === 'issued' ? 'issued' : errorCategory(submission.result) })) })) } : null,
    sensorFields: metrics.policy?.sensorFields || null,
    timing: { alignment: 'server_receipt', browserVideoLatencyMs: null, wheelCommandExpiryMs: null },
    events: state.activity.map(({ at, message }) => ({ atUnixMs: at, message })),
    unavailable: ['browser_video_latency', 'actual_physical_command_execution', 'live_training_cpu_utilization'],
  };
}
module.exports = { report };
