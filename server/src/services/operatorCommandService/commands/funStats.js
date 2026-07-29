// Operator Fun Stats Commands
// Purpose: Implements the fun commands that read or extend persistent counters (bonkboard, pet, snitch).
// Scope: Reads the roster and the fun stats store; issues no rover commands.
const { getCommandConfig } = require('../../operatorCommandService/config');
const { describeWait } = require('../cooldowns');
const { PLAIN_MENTIONS, actorLabel, buildActorKey, createRoverResolver } = require('./funHelpers');

const PET_COOLDOWN_MS = 10 * 1000;
const READ_COOLDOWN_MS = 5 * 1000;
const LEADERBOARD_SIZE = 10;

function formatLeaderboard(title, rows, counter) {
  const ranked = rows
    .filter((row) => Number(row[counter]) > 0)
    .sort((left, right) => Number(right[counter]) - Number(left[counter]))
    .slice(0, LEADERBOARD_SIZE);
  if (!ranked.length) return null;
  const lines = ranked.map((row, index) => `${index + 1}. ${row.label || 'unknown'} — ${row[counter]}`);
  return [`**${title}**`, ...lines].join('\n');
}

function createFunStatsCommands({
  io,
  rovers,
  getNickname,
  getActiveDrivers,
  getActorSocket,
  roverManager,
  sanitizeMentions,
  funStatsService,
  cooldowns,
  config,
}) {
  const { prefix: commandPrefix } = getCommandConfig(config);
  const safe = (text) => (sanitizeMentions ? sanitizeMentions(text) : String(text || ''));

  function reply(message, content) {
    return message.reply({ content: safe(content), allowedMentions: PLAIN_MENTIONS });
  }

  function gate(message, action, windowMs) {
    const actorKey = buildActorKey(message);
    if (!actorKey) return { error: 'Could not identify you well enough to do that.' };
    const wait = cooldowns.consume(`${action}:${actorKey}`, windowMs);
    if (wait > 0) return { error: `Slow down — try \`${commandPrefix} ${action}\` again in ${describeWait(wait)}.` };
    return { actorKey, label: actorLabel(message) };
  }

  const resolveTargetRover = createRoverResolver({ rovers, roverManager, getActorSocket, commandPrefix });

  async function handleBonkboard(message) {
    const gated = gate(message, 'bonkboard', READ_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const rows = funStatsService.listActorStats();
    const sections = [
      formatLeaderboard('Most bonks dealt', rows, 'bonksGiven'),
      formatLeaderboard('Most bonks taken', rows, 'bonksTaken'),
      formatLeaderboard('Most hugs given', rows, 'hugsGiven'),
    ].filter(Boolean);

    if (!sections.length) {
      return reply(message, `Nobody has been bonked yet. Fix that with \`${commandPrefix} bonk <user>\`.`);
    }
    return reply(message, sections.join('\n\n').slice(0, 1900));
  }

  async function handlePet(message, tokens = []) {
    const gated = gate(message, 'pet', PET_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const rover = resolveTargetRover(tokens.join(' '), 'pet');
    if (rover.error) return reply(message, rover.error);

    const pets = funStatsService.bumpRoverPets(rover.id, 1);
    return reply(message, `🤖 ${gated.label} pets ${rover.name}. It has now been petted ${pets} time${pets === 1 ? '' : 's'}.`);
  }

  /*
    Reads the same active-driver map the turn system uses, so it reports real
    control rather than who merely has the page open. Rovers with nobody driving
    are listed too — an empty fleet is exactly what a snitch should report.
  */
  async function handleSnitch(message) {
    const gated = gate(message, 'snitch', READ_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const drivers = getActiveDrivers?.() || {};
    const sockets = io?.sockets?.sockets;
    const lines = [];

    rovers.forEach((record, roverId) => {
      const id = String(roverId);
      const name = record?.meta?.name || id;
      const socketId = drivers[id];
      const socket = socketId && sockets?.get ? sockets.get(socketId) : null;
      const nickname = socket ? getNickname?.(socket) : null;
      if (nickname) {
        lines.push(`• ${name} — ${nickname}`);
      } else if (socketId) {
        lines.push(`• ${name} — someone who will not say their name`);
      } else {
        lines.push(`• ${name} — nobody`);
      }
    });

    if (!lines.length) return reply(message, 'No rovers are online to snitch about.');
    return reply(message, ['🕵️ Currently driving:', ...lines].join('\n').slice(0, 1900));
  }

  return {
    bonkboard: handleBonkboard,
    pet: handlePet,
    snitch: handleSnitch,
  };
}

module.exports = { createFunStatsCommands, formatLeaderboard };
