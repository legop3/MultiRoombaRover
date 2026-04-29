// Discord Goal Command
// Purpose: Handles community goal view/update/clear operations.
// Scope: Allows read by all and write by admins.
function createGoalCommand({ getCommunityGoal, setCommunityGoal, clearCommunityGoal, isAdminUser, sanitizeMentions }) {
  return async function handleGoalCommand(message, tokens) {
    const query = tokens.join(' ').trim();
    const lower = query.toLowerCase();
    if (!query) {
      const goal = getCommunityGoal();
      await message.reply({ content: goal?.text ? `Community goal: ${sanitizeMentions(goal.text)}` : 'No community goal set.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    if (!isAdminUser(message.author.id)) {
      await message.reply({ content: 'Only admins can update the community goal.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      if (lower === 'clear') {
        clearCommunityGoal({ by: message.author?.id || null });
        await message.reply({ content: 'Community goal cleared.', allowedMentions: { parse: [], repliedUser: false } });
      } else {
        setCommunityGoal(query, { by: message.author?.id || null });
        await message.reply({ content: sanitizeMentions(`Community goal set: ${query}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed to update goal: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createGoalCommand };
