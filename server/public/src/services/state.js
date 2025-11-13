registerModule('services/state', (require, exports) => {
  let selectedRover = null;
  let role = 'user';
  const roleListeners = new Set();

  function setSelected(roverId) {
    selectedRover = roverId;
  }

  function getSelected() {
    return selectedRover;
  }

  function setRole(nextRole) {
    role = nextRole;
    roleListeners.forEach((cb) => cb(role));
  }

  function getRole() {
    return role;
  }

  function onRoleChange(cb) {
    roleListeners.add(cb);
    cb(role);
    return () => roleListeners.delete(cb);
  }

  exports.setSelected = setSelected;
  exports.getSelected = getSelected;
  exports.setRole = setRole;
  exports.getRole = getRole;
  exports.onRoleChange = onRoleChange;
});
