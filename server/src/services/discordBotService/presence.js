// Discord Presence Module
// Purpose: Owns rotating Discord presence text derived from rover readiness, mode, and community goals.
// Scope: Handles presence update scheduling/state and exposes start/recompute controls for orchestration.
const { ActivityType } = require('discord.js');

function createPresenceManager({ client, logger, getMode, getCommunityGoal, countReady }) {
  const PRESENCE_ROTATE_MS = 20000;
  let presenceInterval = null;
  let presenceShowGoal = false;

  function truncatePresenceText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - 3)}...`;
  }

  function buildPresenceName() {
    const { ready, total } = countReady();
    const mode = getMode();
    const goal = getCommunityGoal();
    const goalText = goal?.text ? String(goal.text).trim() : '';
    if (presenceShowGoal && goalText) {
      const trimmed = truncatePresenceText(goalText, 110);
      return `Goal: ${trimmed}`;
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
    const goal = getCommunityGoal();
    if (!goal?.text) {
      presenceShowGoal = false;
      updatePresence();
      return;
    }
    presenceShowGoal = false;
    updatePresence();
    presenceInterval = setInterval(() => {
      presenceShowGoal = !presenceShowGoal;
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
