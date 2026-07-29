// Operator Command Registry
// Purpose: Describes command categories, discovery text, permissions, and feature requirements in one place.
// Scope: Supplies transport-neutral metadata; execution handlers remain focused on server operations.
const CATEGORIES = {
  system: { title: 'System', names: ['help', 'status', 'replay', 'time-status'] },
  admin: { title: 'Admin', names: ['lock', 'unlock', 'mode', 'reason', 'goal', 'kick', 'verify', 'deter'] },
  features: { title: 'Features', names: ['lights', 'lift', 'neato'] },
  fun: {
    title: 'Fun',
    names: [
      'bonk', 'hug', 'slap', 'bonkboard', '8ball', 'roll', 'coin', 'ship', 'rate', 'uwu',
      'wanted', 'pet', 'snitch', 'honk', 'boo', 'spin', 'disco', 'vibecheck',
    ],
  },
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
    lift: { category: 'features', summary: 'Show or move the lift.', usage: [`${prefix} lift <status|up|down>`], access: 'Public unless server access is restricted', permission: 'access-mode', requiredFeature: 'lift', unavailableLabel: 'Lift' },
    neato: { category: 'features', summary: 'Show or control Neato.', usage: [`${prefix} neato <status|start|home|locate|clear-errors>`], access: 'Public unless server access is restricted', permission: 'access-mode', requiredFeature: 'neato', unavailableLabel: 'Neato' },
    bridge: { category: 'discord', summary: 'Configure this Discord server chat bridge.', usage: [`${prefix} bridge`, `${prefix} bridge here <global|private>`, `${prefix} bridge mode <global|private>`, `${prefix} bridge off`], access: 'Discord server manager' },
    /*
      Fun commands are the first entries to use `permission: 'public'`. Before
      they existed, every non-admin-reachable command was named in a hardcoded
      allowlist in the dispatcher; declaring the permission here instead means a
      new fun command does not need a dispatcher edit to be usable.
    */
    bonk: { category: 'fun', summary: 'Bonk someone. Keeps a running tally.', usage: [`${prefix} bonk <user>`], access: 'Public', permission: 'public' },
    hug: { category: 'fun', summary: 'Hug someone.', usage: [`${prefix} hug <user>`], access: 'Public', permission: 'public' },
    slap: { category: 'fun', summary: 'Slap someone with a random object.', usage: [`${prefix} slap <user>`], access: 'Public', permission: 'public' },
    bonkboard: { category: 'fun', summary: 'Show the bonk and hug leaderboards.', usage: [`${prefix} bonkboard`], access: 'Public', permission: 'public' },
    '8ball': { category: 'fun', summary: 'Ask the magic 8 ball. Same question always gets the same answer.', usage: [`${prefix} 8ball <question>`], access: 'Public', permission: 'public' },
    roll: { category: 'fun', summary: 'Roll dice.', usage: [`${prefix} roll [NdN]`], access: 'Public', permission: 'public' },
    coin: { category: 'fun', summary: 'Flip a coin.', usage: [`${prefix} coin`], access: 'Public', permission: 'public' },
    ship: { category: 'fun', summary: 'Rate a pairing out of 100.', usage: [`${prefix} ship <a> and <b>`], access: 'Public', permission: 'public' },
    rate: { category: 'fun', summary: 'Rate anything out of 10.', usage: [`${prefix} rate <thing>`], access: 'Public', permission: 'public' },
    uwu: { category: 'fun', summary: 'Ruin some text.', usage: [`${prefix} uwu <text>`], access: 'Public', permission: 'public' },
    wanted: { category: 'fun', summary: 'Issue a wanted poster.', usage: [`${prefix} wanted <user>`], access: 'Public', permission: 'public' },
    pet: { category: 'fun', summary: 'Pet a rover. Each rover keeps its own count.', usage: [`${prefix} pet [rover]`], access: 'Public', permission: 'public' },
    snitch: { category: 'fun', summary: 'Report who is driving what.', usage: [`${prefix} snitch`], access: 'Public', permission: 'public' },
    // honk and spin move hardware, so their handlers additionally require that the
    // caller actually holds control of the rover they name.
    honk: { category: 'fun', summary: 'Sound a short horn toot on a rover you control.', usage: [`${prefix} honk [rover]`], access: 'Public; requires control of the rover', permission: 'public' },
    boo: { category: 'fun', summary: 'Speak a taunt through the rover someone is driving.', usage: [`${prefix} boo <user>`], access: 'Public', permission: 'public' },
    spin: { category: 'fun', summary: 'Make a rover you control do a spin.', usage: [`${prefix} spin [rover]`], access: 'Public; requires control of the rover', permission: 'public' },
    vibecheck: { category: 'fun', summary: 'Judge a rover\'s vibes and report its battery.', usage: [`${prefix} vibecheck [rover]`], access: 'Public', permission: 'public' },
    disco: {
      category: 'fun',
      summary: 'Strobe the room lights briefly.',
      usage: [`${prefix} disco`],
      access: 'Public unless server access is restricted; obeys the room-light lock',
      permission: 'access-mode',
      requiredFeature: 'homeAssistant',
      unavailableLabel: 'Home Assistant',
    },
  };
}

module.exports = { CATEGORIES, buildCommandRegistry };
