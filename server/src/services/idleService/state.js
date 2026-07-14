// Idle Service State
// Purpose: Stores runtime timer and bookkeeping state for idle automation scheduling.
// Scope: Encapsulates mutable idle-tracking data shared by idle service modules.
const runtime = {
  timer: null,
  deadlineAt: null,
  lastTriggeredAt: null,
  idleActionsCompleted: false,
};

module.exports = {
  runtime,
};
