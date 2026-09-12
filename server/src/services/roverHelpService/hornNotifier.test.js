// Rover Help Horn Notifier Tests
// Purpose: Verifies the exact chirp payload, cadence, duration, and cleanup without real timers.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HELP_HORN_DURATION_MS,
  HELP_HORN_FREQUENCY_HZ,
  HELP_HORN_INTERVAL_MS,
  HELP_ROOMBA_NOTE,
  HELP_ROOMBA_NOTE_DURATION,
  HELP_ROOMBA_SONG_SLOT,
  createHelpHornNotifier,
} = require('./hornNotifier');

function createHarness({ enabled = true } = {}) {
  const commands = [];
  const intervals = new Map();
  const timeouts = new Map();
  const clearedIntervals = [];
  const clearedTimeouts = [];
  let nextTimerId = 1;
  const notifier = createHelpHornNotifier({
    getRover: () => ({ ws: {}, meta: { horn: { enabled } } }),
    issueCommand: (roverId, payload) => commands.push({ roverId, payload }),
    setIntervalFn: (callback, ms) => {
      const id = nextTimerId++;
      intervals.set(id, { callback, ms });
      return id;
    },
    clearIntervalFn: (id) => clearedIntervals.push(id),
    setTimeoutFn: (callback, ms) => {
      const id = nextTimerId++;
      timeouts.set(id, { callback, ms });
      return id;
    },
    clearTimeoutFn: (id) => clearedTimeouts.push(id),
  });
  return { clearedIntervals, clearedTimeouts, commands, intervals, notifier, timeouts };
}

test('starts matching external and Roomba chirps and schedules the agreed cadence', () => {
  const harness = createHarness();
  harness.notifier.start('red');

  assert.deepEqual(harness.commands, [
    {
      roverId: 'red',
      payload: {
        type: 'horn',
        horn: { action: 'start', waveform: 'saw', freqs: [HELP_HORN_FREQUENCY_HZ] },
      },
    },
    {
      roverId: 'red',
      payload: {
        type: 'song',
        song: {
          slot: HELP_ROOMBA_SONG_SLOT,
          notes: [{ note: HELP_ROOMBA_NOTE, duration: HELP_ROOMBA_NOTE_DURATION }],
        },
      },
    },
  ]);
  assert.equal(Array.from(harness.intervals.values())[0].ms, HELP_HORN_INTERVAL_MS);
  assert.equal(Array.from(harness.timeouts.values())[0].ms, HELP_HORN_DURATION_MS);

  Array.from(harness.timeouts.values())[0].callback();
  assert.equal(harness.commands.at(-1).payload.horn.action, 'stop');
});

test('stop cancels cadence and pending pulse before issuing a final horn stop', () => {
  const harness = createHarness();
  harness.notifier.start('blue');
  const intervalId = Array.from(harness.intervals.keys())[0];
  const timeoutId = Array.from(harness.timeouts.keys())[0];

  harness.notifier.stop('blue');
  assert.deepEqual(harness.clearedIntervals, [intervalId]);
  assert.deepEqual(harness.clearedTimeouts, [timeoutId]);
  assert.equal(harness.commands.at(-1).payload.horn.action, 'stop');
});

test('still schedules the Roomba song when the external horn is disabled', () => {
  const harness = createHarness({ enabled: false });
  harness.notifier.start('green');
  assert.deepEqual(harness.commands, [{
    roverId: 'green',
    payload: {
      type: 'song',
      song: {
        slot: HELP_ROOMBA_SONG_SLOT,
        notes: [{ note: HELP_ROOMBA_NOTE, duration: HELP_ROOMBA_NOTE_DURATION }],
      },
    },
  }]);
  assert.equal(harness.intervals.size, 1);
  assert.equal(harness.timeouts.size, 0);
});
