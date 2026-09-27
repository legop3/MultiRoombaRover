// Queue entries are complete display records. No browser-side user lookup or
// naming fallback is needed, including when the queue comes from another server.
function describeQueue(socketIds, currentId, users) {
  const byId = new Map(users.map((user) => [user.socketId, user]));
  const currentIndex = currentId ? socketIds.indexOf(currentId) : -1;
  return {
    queue: socketIds.map((socketId) => {
      const user = byId.get(socketId);
      return {
        socketId,
        name: user?.nickname || user?.name || socketId.slice(0, 6) || 'unknown',
        role: user?.role || null,
      };
    }),
    currentId,
    nextId: socketIds.length > 1 ? socketIds[(currentIndex + 1) % socketIds.length] : null,
  };
}

module.exports = { describeQueue };
