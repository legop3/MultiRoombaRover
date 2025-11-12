function isAdmin(/* socket */) {
  return false;
}

function isLockdownAdmin(/* socket */) {
  return false;
}

module.exports = {
  isAdmin,
  isLockdownAdmin,
};
