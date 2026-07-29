// Operator Command Dispatcher Tests
// Purpose: Pins the permission, mode, and prefix policy that the registry-driven gate replaced a hardcoded action list with.
// Scope: Exercises the router with doubles; individual command behavior is covered by each command's own tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandHandlers } = require('./index');

const MODES = { OPEN: 'open', TURNS: 'turns', ADMIN: 'admin', LOCKDOWN: 'lockdown' };
const ADMIN_DENIAL = /Only admins can run that command/;
const LOCKDOWN_DENIAL = /Lockdown mode: only lockdown admins/;
const FEATURE_DENIAL = /Admin mode: only admins can run feature commands/;

const ALICE = { id: 's1', data: { userId: 'u-alice', nickname: 'alice' } };

function createRouter({ mode = MODES.OPEN, featureEnabled = true } = {}) {
  const rovers = new Map([['rover-1', {
    id: 'rover-1',
    ws: {},
    meta: { name: 'Roomba One', horn: { enabled: true } },
    batteryState: { percentDisplay: 50 },
  }]]);

  const { handleCommand } = createCommandHandlers({
    logger: { warn: () => {}, info: () => {} },
    io: { sockets: { sockets: new Map([[ALICE.id, ALICE]]) } },
    rovers,
    roverManager: {
      canDrive: () => true,
      getPrimaryRoverForSocket: () => 'rover-1',
      applyPrivateDriveSafety: () => null,
    },
    getMode: () => mode,
    MODES,
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => ({}),
    getActorSocket: () => ALICE,
    issueCommand: () => 'cmd-1',
    isFeatureEnabled: () => featureEnabled,
    sanitizeMentions: (text) => String(text || ''),
    funStatsService: {
      bumpActorStats: () => ({}),
      getActorStats: () => ({}),
      listActorStats: () => [],
      bumpRoverPets: () => 1,
      getRoverPets: () => 0,
    },
    homeAssistantService: { getLightPolicyState: () => ({}), setAllControllableEntitiesState: () => Promise.resolve() },
    liftService: null,
    neatoService: null,
    listVerifiedUsers: () => [],
    listDeterredUsers: () => [],
    listMutedUsers: () => [],
    getGlobalObjective: () => null,
    getAdminReason: () => null,
    config: { commands: { prefix: 'rs' } },
    transportHandlers: {
      status: async (request) => request.reply({ content: '[status handler]' }),
      bridge: async (request) => request.reply({ content: '[bridge handler]' }),
    },
  });

  return async function run(text, actor) {
    const replies = [];
    await handleCommand({
      content: text,
      transport: 'web-chat',
      actor,
      reply: async (payload) => {
        replies.push(typeof payload === 'string' ? payload : payload?.content);
      },
    });
    return replies.join('\n');
  };
}

const nonAdmin = { id: 's1', userId: 'u-alice', label: 'alice', isAdmin: false, isLockdownAdmin: false };
const admin = { id: 's1', userId: 'u-alice', label: 'alice', isAdmin: true, isLockdownAdmin: false };
const lockdownAdmin = { id: 's1', userId: 'u-alice', label: 'alice', isAdmin: true, isLockdownAdmin: true };

test('a non-admin can run fun commands', async () => {
  const run = createRouter();
  for (const command of ['rs coin', 'rs rate carpet', 'rs uwu hi', 'rs bonkboard', 'rs vibecheck', 'rs snitch']) {
    const reply = await run(command, nonAdmin);
    assert.doesNotMatch(reply, ADMIN_DENIAL, `${command} should be public`);
    assert.ok(reply.length > 0, `${command} should reply`);
  }
});

test('admin-only commands stay admin-only for a non-admin', async () => {
  const run = createRouter();
  for (const command of ['rs lock rover-1', 'rs unlock rover-1', 'rs mode open', 'rs kick alice']) {
    assert.match(await run(command, nonAdmin), ADMIN_DENIAL, `${command} must stay admin-only`);
  }
});

test('commands that police themselves still reach their handler as a non-admin', async () => {
  const run = createRouter();
  // These reply with their own role-specific message, so the dispatcher must not
  // short-circuit them with the generic admin denial.
  for (const command of ['rs goal', 'rs reason', 'rs verify list', 'rs deter list']) {
    assert.doesNotMatch(await run(command, nonAdmin), ADMIN_DENIAL, `${command} enforces its own permission`);
  }
});

test('system commands remain reachable by anyone', async () => {
  const run = createRouter();
  assert.match(await run('rs status', nonAdmin), /\[status handler\]/);
  assert.match(await run('rs', nonAdmin), /\[status handler\]/);
  assert.match(await run('rs help', nonAdmin), /Rover Bot Commands/);
});

test('the fun category appears in help', async () => {
  const run = createRouter();
  const help = await run('rs help fun', nonAdmin);
  assert.match(help, /\*\*Fun\*\*/);
  for (const command of ['bonk', 'honk', 'disco', 'vibecheck', 'bonkboard']) {
    assert.match(help, new RegExp(`rs ${command}`), `help should list ${command}`);
  }
});

test('admin mode restricts access-mode feature commands but not the public fun ones', async () => {
  const run = createRouter({ mode: MODES.ADMIN });
  assert.match(await run('rs lights on', nonAdmin), FEATURE_DENIAL);
  assert.match(await run('rs disco', nonAdmin), FEATURE_DENIAL);
  assert.doesNotMatch(await run('rs coin', nonAdmin), FEATURE_DENIAL);
});

test('lockdown suspends the whole fun category for anyone but a lockdown admin', async () => {
  const run = createRouter({ mode: MODES.LOCKDOWN });
  for (const command of ['rs coin', 'rs bonk bob', 'rs honk', 'rs disco', 'rs vibecheck']) {
    assert.match(await run(command, nonAdmin), LOCKDOWN_DENIAL, `${command} should be suspended in lockdown`);
  }
  // A plain admin is not enough during lockdown.
  assert.match(await run('rs coin', admin), LOCKDOWN_DENIAL);
  assert.doesNotMatch(await run('rs coin', lockdownAdmin), LOCKDOWN_DENIAL);
});

test('lockdown still suspends the pre-existing moderation-sensitive commands', async () => {
  const run = createRouter({ mode: MODES.LOCKDOWN });
  for (const command of ['rs lock rover-1', 'rs mode open', 'rs lights on', 'rs goal', 'rs kick alice']) {
    assert.match(await run(command, admin), LOCKDOWN_DENIAL, `${command} should stay lockdown-gated`);
  }
});

test('status and help survive lockdown', async () => {
  const run = createRouter({ mode: MODES.LOCKDOWN });
  assert.match(await run('rs status', nonAdmin), /\[status handler\]/);
  assert.match(await run('rs help', nonAdmin), /Rover Bot Commands/);
});

test('a disabled required feature is reported before any permission check', async () => {
  const run = createRouter({ featureEnabled: false });
  assert.match(await run('rs disco', nonAdmin), /Home Assistant feature is not configured/);
  assert.match(await run('rs lights on', nonAdmin), /Home Assistant feature is not configured/);
});

test('ordinary words that merely start with the prefix are not commands', async () => {
  const run = createRouter();
  assert.equal(await run('rsvp', nonAdmin), '');
  assert.equal(await run('rspecial delivery', nonAdmin), '');
  assert.equal(await run('hello there', nonAdmin), '');
});

test('an unknown command is not treated as public', async () => {
  const run = createRouter();
  // Unknown actions carry no registry entry, so they must fall through to the
  // same admin denial they did before the permission refactor.
  assert.match(await run('rs notacommand', nonAdmin), ADMIN_DENIAL);
  assert.match(await run('rs notacommand', admin), /Rover Bot Commands/);
});

test('bot actors are ignored entirely', async () => {
  const run = createRouter();
  assert.equal(await run('rs coin', { ...nonAdmin, bot: true }), '');
});

test('command matching is case insensitive', async () => {
  const run = createRouter();
  assert.doesNotMatch(await run('RS COIN', nonAdmin), ADMIN_DENIAL);
  assert.match(await run('Rs Status', nonAdmin), /\[status handler\]/);
});
