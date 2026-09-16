// The shared dispatcher supplies admin/lockdown authorization for both chat
// transports. Preserve the remaining tokens so names with spaces need no quotes.
const { getCommandConfig } = require('../config');

function createHaCommand({ homeAssistantActivitiesService: service, config }) {
  return async function handleHaCommand(message, tokens = []) {
    const reply = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
    if (!service) return reply('Home Assistant activities are unavailable.');
    const action = String(tokens[0] || 'status').toLowerCase();
    try {
      if (action === 'status') {
        const items = service.getState().items;
        return reply(items.length ? items.map((item) => `${item.name} (${item.id}): ${item.locked ? 'locked' : 'unlocked'}`).join('\n') : 'No activity items configured.');
      }
      if (!['lock', 'unlock'].includes(action) || tokens.length < 2) {
        return reply(`Use ${getCommandConfig(config).prefix} ha status, or ha <lock|unlock> <name or entity ID>.`);
      }
      const item = service.setLocked(tokens.slice(1).join(' '), action === 'lock');
      return reply(`${item.name} (${item.id}) ${action === 'lock' ? 'locked' : 'unlocked'}.`);
    } catch (error) {
      return reply(error.message);
    }
  };
}

module.exports = { createHaCommand };
