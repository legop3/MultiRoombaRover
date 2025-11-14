registerModule('globals/socket', (require, exports) => {
  const query = {};
  if (window.__desiredRole) {
    query.role = window.__desiredRole;
  }
  const socket = io(query.role ? { query } : undefined);
  exports.socket = socket;
});
