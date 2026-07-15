// Operator Command Registry
// Purpose: Describes command categories, discovery text, permissions, and feature requirements in one place.
// Scope: Supplies transport-neutral metadata; execution handlers remain focused on server operations.
const CATEGORIES = {
  system: { title: 'System', names: ['help', 'status', 'replay', 'time-status'] },
  admin: { title: 'Admin', names: ['lock', 'unlock', 'mode', 'reason', 'goal', 'lights', 'kick', 'verify', 'deter'] },
  features: { title: 'Features', names: ['lift', 'neato'] },
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
    lights: { category: 'admin', summary: 'Show or change the room-light lock.', usage: [`${prefix} lights <status|lock|unlock>`], access: 'Admin', permission: 'admin' },
    kick: { category: 'admin', summary: 'Remove a user from their current rover.', usage: [`${prefix} kick <user> [reason]`], access: 'Admin', permission: 'admin' },
    verify: { category: 'admin', summary: 'List or remove verified identities.', usage: [`${prefix} verify list`, `${prefix} verify remove <identity>`], access: 'Lockdown admin', permission: 'lockdown-admin' },
    deter: { category: 'admin', summary: 'List, add, or remove identity deterrence.', usage: [`${prefix} deter list`, `${prefix} deter ban <identity>`, `${prefix} deter unban <identity>`], access: 'Lockdown admin', permission: 'lockdown-admin' },
    lift: { category: 'features', summary: 'Show or move the lift.', usage: [`${prefix} lift <status|up|down>`], access: 'Admin', permission: 'admin', requiredFeature: 'lift', unavailableLabel: 'Lift' },
    neato: { category: 'features', summary: 'Show or control Neato.', usage: [`${prefix} neato <status|start|home|locate|clear-errors>`], access: 'Admin', permission: 'admin', requiredFeature: 'neato', unavailableLabel: 'Neato' },
    bridge: { category: 'discord', summary: 'Configure this Discord server chat bridge.', usage: [`${prefix} bridge`, `${prefix} bridge here <global|private>`, `${prefix} bridge mode <global|private>`, `${prefix} bridge off`], access: 'Discord server manager' },
  };
}

module.exports = { CATEGORIES, buildCommandRegistry };
