// Operator Lock Command
// Purpose: Handles lock and unlock operations for rover availability control.
// Scope: Applies lock state updates for a single rover ID.
const { resolveRoverSelector } = require('./resolvers');
const { getCommandConfig } = require('../../operatorCommandService/config');

function createLockCommand({ lockRover, sanitizeMentions, rovers, config }) {
  // Only the user-facing example depends on the prefix. The actual lock logic
  // still receives the already-parsed rover selector from the shared router.
  const { prefix: commandPrefix } = getCommandConfig(config);
  return async function handleLockCommand(message, roverId, locked) {
    if (!roverId) {
      await message.reply({ content: `Specify a rover ID. Example: \`${commandPrefix} lock alpha\``, allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      const resolved = resolveRoverSelector(roverId, rovers);
      if (resolved.error) {
        await message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
        return;
      }
      // Mutate by canonical id after fuzzy resolution. This avoids letting a
      // display-name typo create a new path through roverManager, and it also
      // makes the response name match the rover that was actually changed.
      // Preserve the established Discord reason while allowing other adapters
      // to identify themselves without pretending their request came from Discord.
      lockRover(resolved.id, locked, { reason: message.transport === 'discord' ? 'discord' : 'web-chat' });
      await message.reply({ content: sanitizeMentions(`${locked ? 'Locked' : 'Unlocked'} ${resolved.label || resolved.id}.`), allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createLockCommand };
