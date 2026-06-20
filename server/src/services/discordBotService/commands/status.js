// Discord Status Command
// Purpose: Handles rover status display command with battery and lock details.
// Scope: Builds and sends rover status embed for one rover or all visible rovers.
const { EmbedBuilder } = require('discord.js');
const { buildBatteryStatusEmbed } = require('../batteryEmbeds');
const { resolveRoverSelector } = require('./resolvers');

function createStatusCommand({ rovers, roverManager }) {
  return async function handleStatusCommand(message, roverId) {
    const resolved = roverId ? resolveRoverSelector(roverId, rovers) : null;
    if (roverId && resolved?.error) {
      const embed = new EmbedBuilder().setTitle('Rover Status').setDescription(resolved.error).setColor(0x2196f3).setTimestamp(new Date());
      await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    // Status accepts fuzzy display names, but the final status payload is still
    // built from the canonical rover record so battery/private/lock fields stay
    // identical to the all-rover status view.
    const records = roverId ? [resolved.record] : Array.from(rovers.values()).filter((entry) => roverManager.canReplayRoverId(entry?.id));
    await message.reply({
      embeds: [buildBatteryStatusEmbed({ color: 0x2196f3, records })],
      allowedMentions: { parse: [], repliedUser: false },
    });
  };
}

module.exports = { createStatusCommand };
