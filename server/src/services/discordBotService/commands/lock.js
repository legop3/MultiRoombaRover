// Discord Lock Command
// Purpose: Handles `rs lock` and `rs unlock` operations for rover availability control.
// Scope: Applies lock state updates for a single rover ID.
function createLockCommand({ lockRover, sanitizeMentions }) {
  return async function handleLockCommand(message, roverId, locked) {
    if (!roverId) {
      await message.reply({ content: 'Specify a rover ID. Example: `rs lock alpha`', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      lockRover(roverId, locked, { reason: 'discord' });
      await message.reply({ content: sanitizeMentions(`${locked ? 'Locked' : 'Unlocked'} ${roverId}.`), allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createLockCommand };
