// Operator Command Help Tests
// Purpose: Protects the shared chat-help layout and Discord's hard message-size boundary.
// Scope: Tests rendered help text only; command execution and permissions remain dispatcher concerns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatHelp } = require('./help');

// Discord rejects a normal message above 2,000 characters instead of silently
// splitting it. Keeping this assertion beside the help renderer prevents a new
// command description from making `rs help` fail only on the Discord transport.
const DISCORD_MESSAGE_LIMIT = 2000;

test('complete Discord help fits in one message and uses simple punctuation', () => {
  const help = formatHelp({ includeDiscord: true, isFeatureEnabled: () => true });

  assert.ok(help.length <= DISCORD_MESSAGE_LIMIT, `help is ${help.length} characters`);
  assert.doesNotMatch(help, /—/);
  assert.match(help, /- `rs status \[rover\]`: Show rover status/);
  assert.match(help, /\*\*Discord\*\*/);
});

test('removed fun commands and their category are absent from help', () => {
  const help = formatHelp({ includeDiscord: true, isFeatureEnabled: () => true });

  assert.doesNotMatch(help, /\*\*Fun\*\*/);
  for (const command of ['bonk', 'hug', 'slap', 'bonkboard', '8ball', 'roll', 'coin', 'ship', 'rate', 'uwu', 'wanted', 'pet', 'snitch', 'honk', 'boo', 'spin', 'disco', 'vibecheck']) {
    assert.doesNotMatch(help, new RegExp(`rs ${command}(?:\\s|\\x60)`), `${command} should not be advertised`);
  }
});

test('detailed help keeps usage readable without em dashes', () => {
  const help = formatHelp({ topic: 'deter', includeDiscord: true, isFeatureEnabled: () => true });

  assert.match(help, /\*\*deter\*\*/);
  assert.match(help, /Usage:\n- `rs deter list`/);
  assert.doesNotMatch(help, /—/);
});
