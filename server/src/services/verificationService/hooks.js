// Verification Hooks Module
// Purpose: Registers socket and role-change event hooks for identity, verification requests, and reevaluation.
// Scope: Binds framework events to verification-service flows without owning verification business logic.
function registerVerificationHooks(deps) {
  const {
    io,
    roleEvents,
    logger,
    identifySocket,
    createVerificationRequest,
    reevaluateSocketVerification,
    reevaluateSocketDeterrence,
    emitChange,
  } = deps;

  io.on('connection', (socket) => {
    socket.data = socket.data || {};
    socket.data.connectedAt = Date.now();
    identifySocket(socket, {});

    socket.on('session:identify', (payload = {}, cb = () => {}) => {
      try {
        const result = identifySocket(socket, payload || {});
        socket.data.lastClientIdentifyAt = Date.now();
        cb({ success: true, ...result });
      } catch (err) {
        cb({ error: err.message });
      }
    });

    socket.on('verification:request', (_, cb = () => {}) => {
      try {
        const request = createVerificationRequest(socket);
        cb({ success: true, requestId: request.id, status: request.status });
      } catch (err) {
        cb({ error: err.message });
      }
    });
  });

  roleEvents.on('change', ({ socket }) => {
    if (!socket) return;
    try {
      reevaluateSocketVerification(socket);
      reevaluateSocketDeterrence(socket);
      emitChange('role_change', { socketId: socket.id });
    } catch (err) {
      logger.warn('Failed to reevaluate verification on role change', err.message);
    }
  });
}

module.exports = {
  registerVerificationHooks,
};
