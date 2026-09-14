// Admin Socket API
// Purpose: Gives the setup and administration applications one promise-based boundary around acknowledged socket events.
// Scope: Preserves server error codes and validation details so shared UI infrastructure can respond consistently.
export function emitAdminRequest(socket, eventName, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (response = {}) => {
      if (response?.error) {
        const error = new Error(response.error);
        error.code = response.code || null;
        error.validationErrors = response.validationErrors || [];
        error.currentRevision = response.currentRevision || null;
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export const getAdminSnapshot = (socket) => emitAdminRequest(socket, 'adminConfig:get');
export const confirmAdminPassword = (socket, password) => emitAdminRequest(socket, 'adminConfig:confirmPassword', { password });
export const updateConfiguration = (socket, payload) => emitAdminRequest(socket, 'adminConfig:updateConfiguration', payload);
export const importAdminConfigurationFile = (socket, payload) => emitAdminRequest(socket, 'adminConfig:importConfigurationFile', payload);
export const restoreConfigurationRevision = (socket, payload) => emitAdminRequest(socket, 'adminConfig:restoreRevision', payload);
export const createAdministrator = (socket, payload) => emitAdminRequest(socket, 'adminConfig:createAdministrator', payload);
export const updateAdministrator = (socket, payload) => emitAdminRequest(socket, 'adminConfig:updateAdministrator', payload);
export const deleteAdministrator = (socket, id) => emitAdminRequest(socket, 'adminConfig:deleteAdministrator', { id });

export const getSetupStatus = (socket) => emitAdminRequest(socket, 'setup:status');
export const createFirstAdministrator = (socket, payload) => emitAdminRequest(socket, 'setup:createAdministrator', payload);
export const importConfigurationFile = (socket, payload) => emitAdminRequest(socket, 'setup:importConfigurationFile', payload);
