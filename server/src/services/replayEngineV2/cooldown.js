// Replay Cooldown State
// Purpose: Tracks replay trigger cooldown state and emits updates for consumers.
// Scope: Encapsulates replay cooldown timing and trigger bookkeeping.
const EventEmitter = require('events');

const COOLDOWN_MS = 10 * 1000;
const MAX_CONCURRENT_JOBS = 3;
const replayEvents = new EventEmitter();
const activeJobs = new Map();
let status = null;
let lastTriggeredAt = null;
let lastTriggeredBy = null;

function getReplayState() {
  const remainingMs = lastTriggeredAt === null ? 0 : Math.max(0, COOLDOWN_MS - (Date.now() - lastTriggeredAt));
  return {
    cooldownMs: COOLDOWN_MS,
    lastTriggeredAt,
    lastTriggeredBy,
    remainingMs,
    atJobLimit: activeJobs.size >= MAX_CONCURRENT_JOBS,
    activeSourceKeys: [...new Set(Array.from(activeJobs.values()).flatMap((sources) =>
      sources.map((source) => `${source.type}:${source.id}`),
    ))],
    status,
    available: remainingMs === 0 && activeJobs.size < MAX_CONCURRENT_JOBS,
  };
}

function emitUpdate() {
  replayEvents.emit('update', { state: getReplayState(), by: lastTriggeredBy });
}

function tryTriggerReplay({ jobId, by = null } = {}) {
  const state = getReplayState();
  if (state.atJobLimit) {
    return { ok: false, error: 'Replay limit reached: 3 jobs are already being made', state };
  }
  if (state.remainingMs > 0) {
    return { ok: false, error: `Replay cooldown active. Try again in ${Math.ceil(state.remainingMs / 1000)}s.`, remainingMs: state.remainingMs, state };
  }
  if (!jobId) throw new Error('Replay job id required');
  activeJobs.set(jobId, []);
  status = { jobId, status: 'accepted' };
  lastTriggeredAt = Date.now();
  lastTriggeredBy = by;
  emitUpdate();
  return { ok: true, state: getReplayState() };
}

function updateReplayStatus(payload) {
  if (!activeJobs.has(payload.jobId)) return;
  if (payload.jobId === status?.jobId) {
    status = { jobId: payload.jobId, status: payload.status, title: payload.title, message: payload.message };
  }
  if (payload.status === 'ready' || payload.status === 'failed') {
    activeJobs.delete(payload.jobId);
  } else {
    activeJobs.set(payload.jobId, payload.sources || []);
  }
  emitUpdate();
}

module.exports = { tryTriggerReplay, getReplayState, replayEvents, updateReplayStatus };
