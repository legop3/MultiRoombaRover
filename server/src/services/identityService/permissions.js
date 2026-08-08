// Identity Permission Registry
// Purpose: Defines every positive capability that can be granted to a canonical user.
// Scope: Keeps stable database keys and operator-facing descriptions centralized so services and admin tools cannot invent mismatched permission names.
const USER_PERMISSIONS = Object.freeze({
  'audio.personalAdjustment': Object.freeze({
    key: 'audio.personalAdjustment',
    commandName: 'audio-adjustment',
    label: 'Personal audio adjustment',
    description: 'Allows personal horn, text-to-speech, and microphone volume adjustments.',
  }),
});

function listRegisteredPermissions() {
  return Object.values(USER_PERMISSIONS).map((permission) => ({ ...permission }));
}

function requireRegisteredPermission(permissionKey) {
  const key = String(permissionKey || '').trim().toLowerCase();
  const permission = Object.values(USER_PERMISSIONS).find((entry) => (
    entry.key.toLowerCase() === key || entry.commandName.toLowerCase() === key
  ));
  if (!permission) throw new Error('Unknown user permission.');
  return permission;
}

module.exports = {
  USER_PERMISSIONS,
  listRegisteredPermissions,
  requireRegisteredPermission,
};
