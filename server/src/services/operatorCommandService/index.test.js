// Operator Command Dispatcher Tests
// Purpose: Pins shared command permissions, access modes, and prefix parsing.
// Scope: Exercises the router with doubles; individual command behavior is covered by each command's own tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandHandlers } = require('./index');

const MODES = { OPEN: 'open', TURNS: 'turns', ADMIN: 'admin', LOCKDOWN: 'lockdown' };
const ADMIN_DENIAL = /Only admins can run that command/;
const LOCKDOWN_DENIAL = /Lockdown mode: only lockdown admins/;
const FEATURE_DENIAL = /Admin mode: only admins can run feature commands/;

function createRouter({ mode = MODES.OPEN, featureEnabled = true } = {}) {
  const rovers = new Map([['rover-1', {
    id: 'rover-1',
    ws: {},
    meta: { name: 'Roomba One', horn: { enabled: true } },
    batteryState: { percentDisplay: 50 },
  }]]);

  const { handleCommand } = createCommandHandlers({
    logger: { warn: () => {}, info: () => {} },
    io: { sockets: { sockets: new Map() } },
    rovers,
    roverManager: {},
    getMode: () => mode,
    MODES,
    getNickname: (entry) => entry?.data?.nickname || '',
    getActiveDrivers: () => ({}),
    isFeatureEnabled: () => featureEnabled,
    sanitizeMentions: (text) => String(text || ''),
    homeAssistantService: { getLightPolicyState: () => ({}), setAllControllableEntitiesState: () => Promise.resolve() },
    liftService: null,
    neatoService: null,
    listVerifiedUsers: () => [],
    listDeterredUsers: () => [],
    listMutedUsers: () => [],
    listUsersForAdmin: () => [],
    listUsersWithPermission: () => [],
    listRegisteredPermissions: () => [{
      key: 'audio.personalAdjustment',
      commandName: 'audio-adjustment',
      label: 'Personal audio adjustment',
      description: 'Allows personal volume adjustments.',
    }],
    setUserPermission: () => null,
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

test('admin-only commands stay admin-only for a non-admin', async () => {
  const run = createRouter();
  for (const command of ['rs lock rover-1', 'rs unlock rover-1', 'rs mode open', 'rs kick alice', 'rs permissions list']) {
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

test('admin mode restricts access-mode feature commands', async () => {
  const run = createRouter({ mode: MODES.ADMIN });
  assert.match(await run('rs lights on', nonAdmin), FEATURE_DENIAL);
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
  assert.equal(await run('rs status', { ...nonAdmin, bot: true }), '');
});

test('command matching is case insensitive', async () => {
  const run = createRouter();
  assert.match(await run('Rs Status', nonAdmin), /\[status handler\]/);
});
