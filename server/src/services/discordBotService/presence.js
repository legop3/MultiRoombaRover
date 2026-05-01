// Discord Presence Module
// Purpose: Owns rotating Discord presence text derived from rover readiness, mode, and global objectives.
// Scope: Handles presence update scheduling/state and exposes start/recompute controls for orchestration.
const { ActivityType } = require('discord.js');

function createPresenceManager({ client, logger, getMode, getGlobalObjective, countReady }) {
  const PRESENCE_ROTATE_MS = 20000;
  let presenceInterval = null;
  let presenceShowObjective = false;

  function truncatePresenceText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - 3)}...`;
  }

  function buildPresenceName() {
    const { ready, total } = countReady();
    const mode = getMode();
    const objective = getGlobalObjective();
    const objectiveText = objective?.text ? String(objective.text).trim() : '';
    if (presenceShowObjective && objectiveText) {
      const trimmed = truncatePresenceText(objectiveText, 110);
      return `Objective: ${trimmed}`;
    }
    return `${mode} · ${ready}/${total} Rovers Ready`;
  }

  async function updatePresence() {
    if (!client?.user) return;
    try {
      await client.user.setPresence({
        activities: [{ name: buildPresenceName(), type: ActivityType.Watching }],
        status: 'online',
      });
    } catch (err) {
      logger.warn('Failed to update Discord presence', err.message);
    }
  }

  function schedulePresenceRotation() {
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
    const objective = getGlobalObjective();
    if (!objective?.text) {
      presenceShowObjective = false;
      updatePresence();
      return;
    }
    presenceShowObjective = false;
    updatePresence();
    presenceInterval = setInterval(() => {
      presenceShowObjective = !presenceShowObjective;
      updatePresence();
    }, PRESENCE_ROTATE_MS);
  }

  return {
    schedulePresenceRotation,
  };
}

module.exports = {
  createPresenceManager,
};
