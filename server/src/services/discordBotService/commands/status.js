// Discord Status Command
// Purpose: Handles rover status display command with battery and lock details.
// Scope: Builds and sends rover status embed for one rover or all visible rovers.
const { EmbedBuilder } = require('discord.js');
const { buildBatteryStatusEmbed } = require('../batteryEmbeds');

function createStatusCommand({ rovers, roverManager }) {
  function findRoverRecord(id) {
    if (!id) return null;
    for (const record of rovers.values()) {
      if (String(record.id) === String(id) || String(record.meta?.name) === String(id)) return record;
    }
    return null;
  }
  return async function handleStatusCommand(message, roverId) {
    const single = roverId ? findRoverRecord(roverId) : null;
    if (roverId && !single) {
      const embed = new EmbedBuilder().setTitle('Rover Status').setDescription('Unknown rover.').setColor(0x2196f3).setTimestamp(new Date());
      await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const records = roverId ? [single] : Array.from(rovers.values()).filter((entry) => roverManager.canReplayRoverId(entry?.id));
    await message.reply({
      embeds: [buildBatteryStatusEmbed({ color: 0x2196f3, records, includeOi: true })],
      allowedMentions: { parse: [], repliedUser: false },
    });
  };
}

module.exports = { createStatusCommand };
