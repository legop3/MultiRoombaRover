// audio Forward Service bonk sound tests
// Purpose: Verifies the bonk cue plays for a real event and stays contained when the file or rover is missing.
// Scope: Subscribes through the real event bus with a playback double; no ffmpeg runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { publishEvent } = require('../eventBus');
const { registerBonkSound, BONK_SOUND_PATH } = require('./bonkSound');

const soundDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonk-sound-test-'));
const presentSound = path.join(soundDir, 'bonk.wav');
fs.writeFileSync(presentSound, 'not really audio, only the path is read here');
const missingSound = path.join(soundDir, 'absent.wav');

function harness({ soundPath = presentSound, playImpl = null } = {}) {
  const played = [];
  const warnings = [];
  registerBonkSound({
    logger: {
      info: () => {},
      warn: (message, meta) => warnings.push({ message, meta }),
    },
    playServerAudioFile: (roverId, filePath, options) => {
      played.push({ roverId, filePath, options });
      if (playImpl) playImpl();
    },
    soundPath,
  });
  return { played, warnings };
}

// Each registerBonkSound call adds another subscriber to the shared bus, so every
// test publishes a distinct rover id and asserts only on its own rover.
function bonk(roverId) {
  publishEvent({ source: 'test', type: 'fun.bonked', payload: { roverId, targetLabel: 'bob' } });
}

test('a bonk event plays the sound on the named rover', () => {
  const { played } = harness();
  bonk('rover-play');

  const mine = played.filter((entry) => entry.roverId === 'rover-play');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].filePath, presentSound);
  assert.equal(mine[0].options.source, 'bonk');
});

test('an event with no rover id is ignored', () => {
  const { played } = harness();
  publishEvent({ source: 'test', type: 'fun.bonked', payload: {} });
  publishEvent({ source: 'test', type: 'fun.bonked', payload: { roverId: '   ' } });
  assert.equal(played.length, 0);
});

test('a missing sound file skips playback instead of throwing', () => {
  const { played, warnings } = harness({ soundPath: missingSound });
  assert.doesNotThrow(() => bonk('rover-missing'));
  assert.equal(played.filter((entry) => entry.roverId === 'rover-missing').length, 0);
  assert.equal(warnings.length, 0, 'a not-installed sound is informational, not a warning');
});

test('a playback failure is contained and logged rather than thrown at the caller', () => {
  const { warnings } = harness({
    playImpl: () => {
      throw new Error('Rover offline');
    },
  });
  assert.doesNotThrow(() => bonk('rover-offline'));
  assert.ok(warnings.some((entry) => entry.meta?.error === 'Rover offline'));
});

test('the default sound path lives in server/assets, which the webui build does not wipe', () => {
  // webui/vite.config.js builds to ../server/public with emptyOutDir enabled, so a
  // sound stored there would be deleted by the next build.
  assert.match(BONK_SOUND_PATH, /server\/assets\/bonk\.wav$/);
  assert.doesNotMatch(BONK_SOUND_PATH, /server\/public/);
});

test.after(() => {
  fs.rmSync(soundDir, { recursive: true, force: true });
});
