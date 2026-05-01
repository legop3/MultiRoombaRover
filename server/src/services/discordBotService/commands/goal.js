// Discord Goal Command
// Purpose: Handles global objective view/update/clear operations.
// Scope: Allows read by all and write by admins.
function createGoalCommand({ getGlobalObjective, setGlobalObjective, clearGlobalObjective, isAdminUser, sanitizeMentions }) {
  return async function handleGoalCommand(message, tokens) {
    const query = tokens.join(' ').trim();
    const lower = query.toLowerCase();
    if (!query) {
      const goal = getGlobalObjective();
      await message.reply({ content: goal?.text ? `Global objective: ${sanitizeMentions(goal.text)}` : 'No global objective set.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    if (!isAdminUser(message.author.id)) {
      await message.reply({ content: 'Only admins can update the global objective.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      if (lower === 'clear') {
        clearGlobalObjective({ by: message.author?.id || null });
        await message.reply({ content: 'Global objective cleared.', allowedMentions: { parse: [], repliedUser: false } });
      } else {
        setGlobalObjective(query, { by: message.author?.id || null });
        await message.reply({ content: sanitizeMentions(`Global objective set: ${query}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed to update goal: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createGoalCommand };
