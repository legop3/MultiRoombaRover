const { describeQueue } = require('./queueDisplay');
const { TURN_DURATION_MS, IDLE_TIMEOUT_MS } = require('./constants');

const labels = {
  waiting: 'Someone else is driving',
  handoff: 'It’s your turn!',
  active: 'You’re driving',
  idleWarning: 'Start driving or your turn will be skipped',
  activeTimer: 'Your turn',
  waitingTimer: 'Waiting',
  untilTurn: 'until your turn',
  timeRemaining: 'left',
  showTimer: 'Show turn timer',
  hideTimer: 'Hide turn timer',
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
  return {
    target: { id: rover.id, name: rover.name, color: rover.color, fallback: rover.id },
    ...describeQueue(queue, currentDriverId),
    userLabels: Object.fromEntries(queue.map((id) => [id,
      users.find((user) => user.socketId === id)?.nickname || id,
    ])),
    enabled,
    isActive: turnsAhead === 0,
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
