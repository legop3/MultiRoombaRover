// audio Forward Service charge complete sound
// Purpose: Plays the built-in rover sound effect when the battery manager marks a charging cycle done.
// Scope: Keeps the battery policy and audio pipeline decoupled by listening to the server event bus only.
const path = require('path');
const { subscribe } = require('../eventBus');

const DONE_CHARGING_SOUND_PATH = path.resolve(__dirname, '..', '..', '..', 'public', 'donecharging.wav');

function registerChargeCompleteSound(deps) {
  const {
    logger,
    playServerAudioFile,
  } = deps;

  subscribe('battery.unlocked', (event = {}) => {
    const roverId = String(event?.payload?.roverId || '').trim();
    if (!roverId) return;

    try {
      // battery.unlocked is the existing server-side definition of "done
      // charging" because it only fires after the battery manager has waited
      // through its full charge-release policy. Playing from this event avoids
      // duplicating charging thresholds or raw sensor-state guesses here.
      playServerAudioFile(roverId, DONE_CHARGING_SOUND_PATH, {
        source: 'charge-complete',
      });
      logger.info('Played charging complete sound', { roverId, filePath: DONE_CHARGING_SOUND_PATH });
    } catch (err) {
      // A missing/offline rover or unavailable ffmpeg should not affect the
      // battery manager's unlock decision. The sound is an announcement layered
      // on top of the state transition, so failures are logged and contained.
      logger.warn('Failed to play charging complete sound', {
        roverId,
        filePath: DONE_CHARGING_SOUND_PATH,
        error: err?.message || String(err),
      });
    }
  });
}

module.exports = {
  registerChargeCompleteSound,
};
