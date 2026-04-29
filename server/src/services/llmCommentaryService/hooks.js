// llm Commentary Service hooks
// Purpose: Registers socket/admin control hooks and rover/role event listeners for commentary runtime.
// Scope: Keeps runtime behavior unchanged while isolating framework/event wiring from core orchestration.
function registerHooks(deps) {
  const {
    io,
    roleEvents,
    roverManager,
    emitStatusToSocket,
    isAdminSocket,
    clearRuntimeHistory,
    getAdminState,
    onDriverActivity,
    onSensorEvent,
    onRoverRemoved,
  } = deps;

  io.on('connection', (socket) => {
    emitStatusToSocket(socket);
    socket.on('llm:control', ({ controls } = {}, cb = () => {}) => {
      if (!isAdminSocket(socket)) {
        cb({ error: 'Not authorized' });
        return;
      }
      const command = controls?.action || null;
      if (command === 'clearHistory') {
        clearRuntimeHistory();
        cb({ success: true, state: getAdminState() });
        return;
      }
      cb({ error: 'Unknown llm control action' });
    });
  });

  roleEvents.on('change', ({ socket }) => {
    emitStatusToSocket(socket);
  });

  roverManager.managerEvents.on('sensor', onSensorEvent);
  roverManager.managerEvents.on('rover', ({ roverId, action } = {}) => {
    if (action === 'removed' && roverId) {
      onRoverRemoved(roverId);
    }
  });
  roverManager.managerEvents.on('driver', ({ action } = {}) => {
    if (action === 'add') {
      onDriverActivity();
    }
  });
}

module.exports = {
  registerHooks,
};
