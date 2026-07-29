// Operator Fun Text Commands
// Purpose: Implements the social, text-only `rs` commands (bonk, hug, slap, 8ball, roll, coin, ship, rate, uwu, wanted).
// Scope: Text and counters only; nothing here touches rover hardware.
const { getCommandConfig } = require('../../operatorCommandService/config');
const { describeWait } = require('../cooldowns');
const {
  PLAIN_MENTIONS,
  actorLabel,
  buildActorKey,
  clampEcho,
  hashSeed,
  ordinal,
  pairSeed,
  percentFromSeed,
  pickBySeed,
  resolveFunTarget,
} = require('./funHelpers');

const TEXT_COOLDOWN_MS = 4 * 1000;

/*
  The bonk sound gets its own, much longer rover-scoped window. Playing it
  interrupts whatever that rover is forwarding — including a live microphone — so
  the audio must not be spammable even though the text bonk stays snappy, and a
  group of people bonking one driver cannot chain it either.
*/
const BONK_SOUND_ROVER_COOLDOWN_MS = 20 * 1000;

const SLAP_ITEMS = [
  'a large trout', 'a rolled-up service manual', 'a dead AA battery', 'a docking station',
  'a suspiciously warm power brick', 'half a roll of duct tape', 'a decommissioned brush guard',
  'a bag of loose screws', 'an unlabelled USB cable', 'a soggy floor sensor',
  'the heaviest available wrench', 'a stack of unread pull requests',
];

const EIGHT_BALL_ANSWERS = [
  'Yes.', 'No.', 'Absolutely.', 'Absolutely not.', 'Ask again once the battery is charged.',
  'Signs point to the docking station.', 'The overseer says no.', 'Almost certainly.',
  'Not while anyone is watching.', 'Outlook cloudy, sensors dirty.', 'Try it and find out.',
  'That is a maintenance window problem.', 'Only on a Tuesday.', 'The rover has already decided.',
];

const HUG_FLAVOURS = [
  'gently', 'aggressively', 'with both brush guards', 'at full wheel speed',
  'for slightly too long', 'while beeping softly', 'without asking first',
];

const WANTED_CRIMES = [
  'reckless docking', 'driving with the brush on indoors', 'excessive honking',
  'unauthorised carpet donuts', 'battery hoarding', 'ignoring the global objective',
  'parking in the doorway', 'nine consecutive turn skips', 'talking to the Neato',
  'strobing the room lights for fun', 'stealing another rover\'s charger',
];

const RATE_SUFFIXES = [
  'No further questions.', 'I stand by this.', 'Do not appeal.', 'Take it or leave it.',
  'The sensors agree.', 'This rating is final.',
];

/*
  A dice roll is one of the few places a fun command should be genuinely random:
  the whole point is that nobody can predict it. Everything that passes judgement
  on a thing (`ship`, `rate`, `8ball`, `wanted`) is seeded from the input instead,
  so re-running it cannot reroll a verdict somebody disliked.
*/
function rollDice(count, sides) {
  let total = 0;
  const rolls = [];
  for (let index = 0; index < count; index += 1) {
    const value = 1 + Math.floor(Math.random() * sides);
    rolls.push(value);
    total += value;
  }
  return { rolls, total };
}

function parseDiceSpec(spec) {
  const text = String(spec || '').trim().toLowerCase() || '1d6';
  const match = /^(\d*)d(\d+)$/.exec(text);
  if (!match) {
    // A bare number is read as a single die with that many sides so `rs roll 20`
    // does the obvious thing instead of erroring.
    const bare = /^(\d+)$/.exec(text);
    if (!bare) return { error: 'Roll format is `NdN`, for example `2d6`.' };
    const sides = Number(bare[1]);
    if (sides < 2 || sides > 1000) return { error: 'Dice need between 2 and 1000 sides.' };
    return { count: 1, sides };
  }
  const count = match[1] === '' ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || count > 20) return { error: 'Roll between 1 and 20 dice.' };
  if (sides < 2 || sides > 1000) return { error: 'Dice need between 2 and 1000 sides.' };
  return { count, sides };
}

function uwuify(text) {
  return String(text || '')
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiou])/g, 'Ny$1')
    .replace(/ove/g, 'uv')
    .replace(/!+/g, ' !!');
}

function createFunTextCommands({
  io,
  getNickname,
  getActiveDrivers,
  publishEvent,
  sanitizeMentions,
  funStatsService,
  cooldowns,
  config,
}) {
  const { prefix: commandPrefix } = getCommandConfig(config);
  const safe = (text) => (sanitizeMentions ? sanitizeMentions(text) : String(text || ''));

  /*
    Announces the bonk so audioForwardService can play the sound on the rover the
    target is driving. Published as an event rather than calling the audio pipeline
    directly, matching how the charging-complete cue is wired: the command layer
    stays unaware of ffmpeg, and a server without the sound installed simply has
    nothing listening that can do anything.
  */
  function announceBonk(targetSocket, targetLabel, actorLabelText) {
    if (!targetSocket || typeof publishEvent !== 'function') return;

    const drivers = getActiveDrivers?.() || {};
    const roverId = Object.keys(drivers).find((id) => drivers[id] === targetSocket.id) || null;
    if (!roverId) return;

    if (cooldowns.consume(`bonk:sound:${roverId}`, BONK_SOUND_ROVER_COOLDOWN_MS) > 0) return;

    publishEvent({
      source: 'funCommands',
      type: 'fun.bonked',
      payload: { roverId, targetLabel, actor: actorLabelText },
    });
  }

  function reply(message, content) {
    return message.reply({ content: safe(content), allowedMentions: PLAIN_MENTIONS });
  }

  /*
    Every fun command runs through one gate so the cooldown, the actor identity,
    and the "who am I talking about" resolution cannot drift apart between
    commands. `needsTarget` commands reply with their own usage line when the
    selector is missing rather than silently acting on nothing.
  */
  function gate(message, action, { windowMs = TEXT_COOLDOWN_MS } = {}) {
    const actorKey = buildActorKey(message);
    if (!actorKey) return { error: 'Could not identify you well enough to do that.' };
    const wait = cooldowns.consume(`${action}:${actorKey}`, windowMs);
    if (wait > 0) return { error: `Slow down — try \`${commandPrefix} ${action}\` again in ${describeWait(wait)}.` };
    return { actorKey, label: actorLabel(message) };
  }

  function target(selector) {
    return resolveFunTarget({ io, getNickname, selector });
  }

  /*
    Shared shape for the three "do a thing to someone" commands. Only the verb,
    the counter names, and the flavour text differ, and keeping them in one place
    means a fix to self-targeting or tally credit applies to all of them.
  */
  function createInteraction({ action, counterGiven, counterTaken, selfReply, render, onApplied }) {
    return async function handleInteraction(message, tokens = []) {
      const selector = tokens.join(' ').trim();
      if (!selector) {
        return reply(message, `Usage: \`${commandPrefix} ${action} <user>\``);
      }

      const gated = gate(message, action);
      if (gated.error) return reply(message, gated.error);

      const resolved = target(selector);
      if (!resolved) return reply(message, `Usage: \`${commandPrefix} ${action} <user>\``);

      if (resolved.actorKey && resolved.actorKey === gated.actorKey) {
        return reply(message, selfReply(gated.label));
      }

      funStatsService.bumpActorStats(gated.actorKey, { label: gated.label, [counterGiven]: 1 });
      const targetStats = resolved.actorKey
        ? funStatsService.bumpActorStats(resolved.actorKey, { label: resolved.label, [counterTaken]: 1 })
        : null;

      // Side effects run after the tallies so a failure in an optional extra (the
      // bonk sound) cannot cost the user their recorded bonk.
      onApplied?.({ actor: gated.label, resolved });

      return reply(message, render({
        actor: gated.label,
        actorKey: gated.actorKey,
        targetLabel: resolved.label,
        targetOnline: resolved.online,
        takenCount: targetStats ? targetStats[counterTaken] : null,
      }));
    };
  }

  const handleBonk = createInteraction({
    action: 'bonk',
    counterGiven: 'bonksGiven',
    counterTaken: 'bonksTaken',
    selfReply: (label) => `${label} bonked themselves. That is between you and the rover.`,
    onApplied: ({ actor, resolved }) => announceBonk(resolved.socket, resolved.label, actor),
    render: ({ targetLabel, takenCount }) => {
      const tally = takenCount ? ` That is their ${ordinal(takenCount)} bonk.` : '';
      return `🔨 Bonked ${targetLabel}.${tally}`;
    },
  });

  const handleHug = createInteraction({
    action: 'hug',
    counterGiven: 'hugsGiven',
    counterTaken: 'hugsTaken',
    selfReply: (label) => `${label} hugged themselves. Genuinely fine. No notes.`,
    render: ({ actor, targetLabel, takenCount }) => {
      const flavour = pickBySeed(HUG_FLAVOURS, hashSeed(`${actor}:${targetLabel}:${takenCount || 0}`));
      const tally = takenCount ? ` (${takenCount} total)` : '';
      return `🫂 ${actor} hugs ${targetLabel} ${flavour}.${tally}`;
    },
  });

  const handleSlap = createInteraction({
    action: 'slap',
    counterGiven: 'slapsGiven',
    counterTaken: 'slapsTaken',
    selfReply: (label) => `${label} slapped themselves with a large trout. Bold.`,
    render: ({ actor, targetLabel, takenCount }) => {
      // Seeding on the running count means the weapon changes every time without
      // being unpredictable for the same repeat number.
      const item = pickBySeed(SLAP_ITEMS, hashSeed(`${actor}:${targetLabel}:${takenCount || 0}`));
      return `🐟 ${actor} slaps ${targetLabel} around a bit with ${item}.`;
    },
  });

  async function handleEightBall(message, tokens = []) {
    const question = clampEcho(tokens.join(' '));
    if (!question) return reply(message, `Usage: \`${commandPrefix} 8ball <question>\``);

    const gated = gate(message, '8ball');
    if (gated.error) return reply(message, gated.error);

    const answer = pickBySeed(EIGHT_BALL_ANSWERS, hashSeed(question));
    return reply(message, `🎱 ${question}\n${answer}`);
  }

  async function handleRoll(message, tokens = []) {
    const gated = gate(message, 'roll');
    if (gated.error) return reply(message, gated.error);

    const spec = parseDiceSpec(tokens.join(''));
    if (spec.error) return reply(message, spec.error);

    const { rolls, total } = rollDice(spec.count, spec.sides);
    const detail = rolls.length > 1 ? ` (${rolls.join(' + ')})` : '';
    return reply(message, `🎲 ${gated.label} rolled ${spec.count}d${spec.sides}: **${total}**${detail}`);
  }

  async function handleCoin(message) {
    const gated = gate(message, 'coin');
    if (gated.error) return reply(message, gated.error);
    const side = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return reply(message, `🪙 ${side}.`);
  }

  async function handleShip(message, tokens = []) {
    const parts = tokens.join(' ').split(/\s+(?:and|\+|&)\s+|\s*,\s*/i).map((part) => clampEcho(part)).filter(Boolean);
    const [left, right] = parts.length >= 2 ? parts : [parts[0], null];
    if (!left || !right) {
      return reply(message, `Usage: \`${commandPrefix} ship <a> and <b>\``);
    }

    const gated = gate(message, 'ship');
    if (gated.error) return reply(message, gated.error);

    const score = percentFromSeed(pairSeed(left, right));
    const verdict = score >= 90 ? 'Get them a shared charging dock.'
      : score >= 65 ? 'Promising.'
        : score >= 35 ? 'Needs work.'
          : score >= 10 ? 'The sensors are not hopeful.'
            : 'Absolutely not.';
    return reply(message, `💞 ${left} + ${right} = **${score}%**. ${verdict}`);
  }

  async function handleRate(message, tokens = []) {
    const thing = clampEcho(tokens.join(' '));
    if (!thing) return reply(message, `Usage: \`${commandPrefix} rate <thing>\``);

    const gated = gate(message, 'rate');
    if (gated.error) return reply(message, gated.error);

    const seed = hashSeed(thing);
    const score = seed % 11;
    const suffix = pickBySeed(RATE_SUFFIXES, seed);
    return reply(message, `📊 I rate ${thing} **${score}/10**. ${suffix}`);
  }

  async function handleUwu(message, tokens = []) {
    const text = clampEcho(tokens.join(' '));
    if (!text) return reply(message, `Usage: \`${commandPrefix} uwu <text>\``);

    const gated = gate(message, 'uwu');
    if (gated.error) return reply(message, gated.error);

    return reply(message, uwuify(text));
  }

  async function handleWanted(message, tokens = []) {
    const selector = tokens.join(' ').trim();
    if (!selector) return reply(message, `Usage: \`${commandPrefix} wanted <user>\``);

    const gated = gate(message, 'wanted');
    if (gated.error) return reply(message, gated.error);

    const resolved = target(selector);
    if (!resolved) return reply(message, `Usage: \`${commandPrefix} wanted <user>\``);

    const seed = hashSeed(resolved.label);
    const crime = pickBySeed(WANTED_CRIMES, seed);
    // Bounty is seeded so a given name always carries the same price. Somebody
    // being permanently worth 12 credits is funnier than a fresh number each time.
    const bounty = 25 + (seed % 4776);
    const stats = resolved.actorKey ? funStatsService.getActorStats(resolved.actorKey) : null;
    const priors = stats && stats.bonksTaken ? `\nPrior bonks on record: ${stats.bonksTaken}.` : '';
    return reply(message, [
      '```',
      '        WANTED',
      `  ${resolved.label}`,
      `  for ${crime}`,
      `  reward: ${bounty} credits`,
      '```',
    ].join('\n') + priors);
  }

  return {
    bonk: handleBonk,
    hug: handleHug,
    slap: handleSlap,
    '8ball': handleEightBall,
    roll: handleRoll,
    coin: handleCoin,
    ship: handleShip,
    rate: handleRate,
    uwu: handleUwu,
    wanted: handleWanted,
  };
}

module.exports = {
  createFunTextCommands,
  // Exported for tests: the parsing and transform rules are the parts most
  // likely to regress, and they are pure.
  parseDiceSpec,
  uwuify,
};
