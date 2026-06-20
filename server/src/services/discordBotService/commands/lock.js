// Discord Lock Command
// Purpose: Handles `rs lock` and `rs unlock` operations for rover availability control.
// Scope: Applies lock state updates for a single rover ID.
const { resolveRoverSelector } = require('./resolvers');

function createLockCommand({ lockRover, sanitizeMentions, rovers }) {
  return async function handleLockCommand(message, roverId, locked) {
    if (!roverId) {
      await message.reply({ content: 'Specify a rover ID. Example: `rs lock alpha`', allowedMentions: { parse: [], repliedUser: false } });
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
      lockRover(resolved.id, locked, { reason: 'discord' });
      await message.reply({ content: sanitizeMentions(`${locked ? 'Locked' : 'Unlocked'} ${resolved.label || resolved.id}.`), allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createLockCommand };
