// Operator Command Registry
// Purpose: Describes command categories, discovery text, permissions, and feature requirements in one place.
// Scope: Supplies transport-neutral metadata; execution handlers remain focused on server operations.
const CATEGORIES = {
  system: { title: 'System', names: ['help', 'status', 'replay', 'time-status'] },
  admin: { title: 'Admin', names: ['lock', 'unlock', 'mode', 'reason', 'goal', 'green', 'kick', 'verify', 'deter', 'permissions'] },
  features: { title: 'Features', names: ['lights', 'lift', 'neato'] },
  discord: { title: 'Discord', names: ['bridge'] },
};

function buildCommandRegistry(prefix, timeCommand) {
  return {
    help: { category: 'system', summary: 'Show command help.', usage: [`${prefix} help [command|category]`] },
    status: { category: 'system', summary: 'Show rover status; rover names can be fuzzy.', usage: [`${prefix} status [rover]`] },
    replay: { category: 'system', summary: 'Create an instant replay from selected sources.', usage: [`${prefix} replay [sources]`] },
    'time-status': { category: 'system', summary: 'Show the current time status.', usage: timeCommand ? [timeCommand] : [] },
    lock: { category: 'admin', summary: 'Lock a rover.', usage: [`${prefix} lock <rover>`], access: 'Admin', permission: 'admin' },
    unlock: { category: 'admin', summary: 'Unlock a rover.', usage: [`${prefix} unlock <rover>`], access: 'Admin', permission: 'admin' },
    mode: { category: 'admin', summary: 'Change the server mode.', usage: [`${prefix} mode <open|turns|admin|lockdown>`], access: 'Admin', permission: 'admin' },
    reason: { category: 'admin', summary: 'Show, set, or clear the admin-mode reason.', usage: [`${prefix} reason [text|clear]`], access: 'Admin to change' },
    goal: { category: 'admin', summary: 'Show, set, or clear the global objective.', usage: [`${prefix} goal [text|clear]`], access: 'Admin to change' },
    green: { category: 'admin', summary: 'Toggle green room and page mode.', usage: [`${prefix} green <on|off>`], access: 'Admin', permission: 'admin', requiredFeature: 'homeAssistant', unavailableLabel: 'Home Assistant' },
    lights: {
      category: 'features',
      summary: 'Control room lights or manage the admin light lock.',
      usage: [
        `${prefix} lights <on|off|colors>`,
        `${prefix} lights <status|lock|unlock>`,
      ],
      access: 'Light controls are public unless server access is restricted; lock controls require admin',
      permission: 'access-mode',
      requiredFeature: 'homeAssistant',
      unavailableLabel: 'Home Assistant',
    },
    kick: { category: 'admin', summary: 'Remove a user from their current rover.', usage: [`${prefix} kick <user> [reason]`], access: 'Admin', permission: 'admin' },
    verify: { category: 'admin', summary: 'List or remove verified identities.', usage: [`${prefix} verify list`, `${prefix} verify remove <identity>`], access: 'Lockdown admin', permission: 'lockdown-admin' },
    deter: {
      category: 'admin',
      summary: 'Manage identity deterrence and mute status.',
      usage: [
        `${prefix} deter list`,
        `${prefix} deter ban <identity>`,
        `${prefix} deter unban <identity>`,
        `${prefix} deter mute <identity>`,
        `${prefix} deter unmute <identity>`,
      ],
      access: 'Lockdown admin',
      permission: 'lockdown-admin',
    },
    permissions: {
      category: 'admin',
      summary: 'Manage registered user permissions.',
      usage: [
        `${prefix} permissions list [permission]`,
        `${prefix} permissions grant <permission> <user>`,
        `${prefix} permissions revoke <permission> <user>`,
      ],
      access: 'Admin',
      permission: 'admin',
    },
    lift: { category: 'features', summary: 'Show or move the lift.', usage: [`${prefix} lift <status|up|down>`], access: 'Public unless server access is restricted', permission: 'access-mode', requiredFeature: 'lift', unavailableLabel: 'Lift' },
    neato: { category: 'features', summary: 'Show or control Neato.', usage: [`${prefix} neato <status|start|home|locate|clear-errors>`], access: 'Public unless server access is restricted', permission: 'access-mode', requiredFeature: 'neato', unavailableLabel: 'Neato' },
    bridge: { category: 'discord', summary: 'Configure this Discord server chat bridge.', usage: [`${prefix} bridge`, `${prefix} bridge here <global|private>`, `${prefix} bridge mode <global|private>`, `${prefix} bridge off`], access: 'Discord server manager' },
  };
}

module.exports = { CATEGORIES, buildCommandRegistry };
