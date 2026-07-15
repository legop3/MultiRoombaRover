// Operator Reason Command
// Purpose: Handles admin-mode reason view/update/clear operations.
// Scope: Allows read by all and write by admins.
function createReasonCommand({ getAdminReason, setAdminReason, clearAdminReason, sanitizeMentions }) {
  return async function handleReasonCommand(message, tokens) {
    const query = tokens.join(' ').trim();
    const lower = query.toLowerCase();
    if (!query) {
      const reason = getAdminReason();
      await message.reply({ content: reason?.text ? `Admin mode reason: ${sanitizeMentions(reason.text)}` : 'No admin mode reason set.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    if (!message.actor?.isAdmin) {
      await message.reply({ content: 'Only admins can update the admin mode reason.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      if (lower === 'clear') {
        clearAdminReason({ by: message.actor?.id || null });
        await message.reply({ content: 'Admin mode reason cleared.', allowedMentions: { parse: [], repliedUser: false } });
      } else {
        setAdminReason(query, { by: message.actor?.id || null });
        await message.reply({ content: sanitizeMentions(`Admin mode reason set: ${query}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed to update reason: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createReasonCommand };
