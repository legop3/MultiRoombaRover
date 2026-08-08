// Identity Database API
// Purpose: Keeps /database socket event names and acknowledgement handling local to the database admin feature.
// Scope: Provides small promise helpers over the shared socket without adding app-wide SessionContext actions.
export function emitIdentityAdmin(socket, eventName, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (resp = {}) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      resolve(resp);
    });
  });
}

export function listUsers(socket) {
  return emitIdentityAdmin(socket, 'identityAdmin:listUsers');
}

export function getUser(socket, userId) {
  return emitIdentityAdmin(socket, 'identityAdmin:getUser', { userId });
}

export function addSignal(socket, userId, type, value) {
  return emitIdentityAdmin(socket, 'identityAdmin:addSignal', { userId, type, value });
}

export function removeSignal(socket, userId, type, value) {
  return emitIdentityAdmin(socket, 'identityAdmin:removeSignal', { userId, type, value });
}

export function setVerified(socket, userId, enabled) {
  return emitIdentityAdmin(socket, 'identityAdmin:setVerified', { userId, enabled });
}

export function setDeterrence(socket, userId, enabled, reason) {
  return emitIdentityAdmin(socket, 'identityAdmin:setDeterrence', { userId, enabled, reason });
}

export function setMuted(socket, userId, enabled) {
  return emitIdentityAdmin(socket, 'identityAdmin:setMuted', { userId, enabled });
}

export function setPermission(socket, userId, permissionKey, enabled) {
  return emitIdentityAdmin(socket, 'identityAdmin:setPermission', { userId, permissionKey, enabled });
}

export function updateFeatureState(socket, userId, namespace, value) {
  return emitIdentityAdmin(socket, 'identityAdmin:updateFeatureState', { userId, namespace, value });
}

export function deleteFeatureState(socket, userId, namespace) {
  return emitIdentityAdmin(socket, 'identityAdmin:deleteFeatureState', { userId, namespace });
}
