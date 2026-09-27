const { describeQueue } = require('./queueDisplay');
const { TURN_DURATION_MS, IDLE_TIMEOUT_MS } = require('./constants');

const labels = {
  ...require('./labels'),
  waiting: 'Someone else is driving',
  active: 'You’re driving',
  showName: 'Show rover name',
  hideName: 'Hide rover name',
};

// Build this from visibility-filtered session data so private rover state stays private.
function buildRoverTurn({ rover, mode, socketId, turnInfo, activeDriverId, users }) {
  const queue = turnInfo?.queue || [];
  // Direct ownership can arrive before queue details on load/reconnect.
  const currentDriverId = activeDriverId || turnInfo?.current || null;
  const currentIndex = currentDriverId ? queue.indexOf(currentDriverId) : -1;
  const userIndex = socketId ? queue.indexOf(socketId) : -1;
  const enabled = mode === 'turns' && queue.length > 1 && currentIndex >= 0 && userIndex >= 0;
  const turnsAhead = enabled ? (userIndex - currentIndex + queue.length) % queue.length : null;
  const display = describeQueue(queue, currentDriverId, users);
  return {
    target: { id: rover.id, name: rover.name, color: rover.color, fallback: rover.id },
    ...display,
    // Null distinguishes a rover that has never had a queue from an empty queue.
    queue: turnInfo ? display.queue : null,
    enabled,
    ownsControl: Boolean(socketId && currentDriverId === socketId),
    turnsAhead,
    queueLength: queue.length,
    deadline: turnInfo?.deadline || null,
    durationMs: TURN_DURATION_MS,
    idleDeadline: turnInfo?.idleDeadline || null,
    idleGraceMs: IDLE_TIMEOUT_MS,
    labels,
  };
}

module.exports = { buildRoverTurn };
