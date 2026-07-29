// audio Forward Service bonk sound
// Purpose: Plays the built-in bonk sound effect on the rover a bonked user is driving.
// Scope: Keeps the fun commands and the audio pipeline decoupled by listening to the server event bus only.
const path = require('path');
const fs = require('fs');
const { subscribe } = require('../eventBus');

/*
  Lives in server/assets rather than server/public because the webui build writes
  to server/public with emptyOutDir enabled, which deletes anything else in there.
  server/assets is a plain checked-in asset directory that no build step touches.
*/
const BONK_SOUND_PATH = path.resolve(__dirname, '..', '..', '..', 'assets', 'bonk.wav');

function registerBonkSound(deps) {
  const {
    logger,
    playServerAudioFile,
    soundPath = BONK_SOUND_PATH,
  } = deps;

  subscribe('fun.bonked', (event = {}) => {
    const roverId = String(event?.payload?.roverId || '').trim();
    if (!roverId) return;

    /*
      The sound is optional. An operator who has not dropped a bonk.wav into
      server/assets still gets a fully working `rs bonk` command, so a missing
      file is reported once at debug volume rather than thrown at the caller.
    */
    if (!fs.existsSync(soundPath)) {
      logger.info('Bonk sound file is not installed; skipping playback', { soundPath });
      return;
    }

    try {
      playServerAudioFile(roverId, soundPath, { source: 'bonk' });
      logger.info('Played bonk sound', { roverId, soundPath });
    } catch (err) {
      // Playback interrupts mic forwarding and spawns ffmpeg, so an offline rover
      // or a missing encoder must not turn into a failed chat command. The bonk
      // itself already happened; the sound is layered on top of it.
      logger.warn('Failed to play bonk sound', {
        roverId,
        soundPath,
        error: err?.message || String(err),
      });
    }
  });
}

module.exports = {
  registerBonkSound,
  BONK_SOUND_PATH,
};
