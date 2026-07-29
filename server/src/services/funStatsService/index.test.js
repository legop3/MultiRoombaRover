// Fun Stats Service Tests
// Purpose: Verifies counter persistence, clamping, and that a corrupt store degrades instead of throwing.
// Scope: Runs against a temporary SERVER_DATA_DIR so the real data directory is never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-stats-test-'));
process.env.SERVER_DATA_DIR = dataDir;

const funStatsService = require('./index');

function reset() {
  try {
    fs.rmSync(funStatsService.STORE_PATH, { force: true });
  } catch {
    // A missing store is the normal starting state.
  }
  funStatsService.resetCacheForTests();
}

test('counters start at zero for an unknown actor', () => {
  reset();
  const stats = funStatsService.getActorStats('user:nobody');
  assert.equal(stats.bonksGiven, 0);
  assert.equal(stats.bonksTaken, 0);
  assert.equal(stats.label, null);
});

test('bumping a counter accumulates and records the label', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { label: 'alice', bonksGiven: 1 });
  const stats = funStatsService.bumpActorStats('user:alice', { label: 'alice', bonksGiven: 1 });
  assert.equal(stats.bonksGiven, 2);
  assert.equal(stats.label, 'alice');
});

test('counters are independent of one another', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { bonksGiven: 3, hugsGiven: 1 });
  const stats = funStatsService.getActorStats('user:alice');
  assert.equal(stats.bonksGiven, 3);
  assert.equal(stats.hugsGiven, 1);
  assert.equal(stats.slapsGiven, 0);
});

test('an unrecognized counter name is ignored rather than silently stored', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { notACounter: 5 });
  const stats = funStatsService.getActorStats('user:alice');
  assert.equal(stats.notACounter, undefined);
});

test('state survives a cold read from disk', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { label: 'alice', bonksGiven: 7 });
  funStatsService.resetCacheForTests();
  assert.equal(funStatsService.getActorStats('user:alice').bonksGiven, 7);
});

test('an empty actor key is refused so anonymous bumps cannot share a bucket', () => {
  reset();
  funStatsService.bumpActorStats('', { bonksGiven: 1 });
  assert.deepEqual(funStatsService.listActorStats(), []);
});

test('rover pets accumulate per rover', () => {
  reset();
  assert.equal(funStatsService.bumpRoverPets('rover-1', 1), 1);
  assert.equal(funStatsService.bumpRoverPets('rover-1', 1), 2);
  assert.equal(funStatsService.bumpRoverPets('rover-2', 1), 1);
  assert.equal(funStatsService.getRoverPets('rover-1'), 2);
  assert.equal(funStatsService.getRoverPets('unknown'), 0);
});

test('listActorStats returns every actor with their key', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { label: 'alice', bonksGiven: 1 });
  funStatsService.bumpActorStats('discord:4242', { label: 'dave', bonksGiven: 2 });
  const keys = funStatsService.listActorStats().map((row) => row.actorKey).sort();
  assert.deepEqual(keys, ['discord:4242', 'user:alice']);
});

test('negative and non-numeric deltas cannot drive a counter below zero', () => {
  reset();
  funStatsService.bumpActorStats('user:alice', { bonksGiven: 1 });
  funStatsService.bumpActorStats('user:alice', { bonksGiven: -50 });
  assert.equal(funStatsService.getActorStats('user:alice').bonksGiven, 0);

  funStatsService.bumpActorStats('user:alice', { bonksGiven: Number.NaN });
  assert.equal(funStatsService.getActorStats('user:alice').bonksGiven, 0);
});

test('labels are trimmed and length capped', () => {
  reset();
  const stats = funStatsService.bumpActorStats('user:alice', { label: `  ${'x'.repeat(200)}  `, bonksGiven: 1 });
  assert.equal(stats.label.length, 64);
});

test('a corrupt store file degrades to empty instead of throwing', () => {
  reset();
  fs.mkdirSync(path.dirname(funStatsService.STORE_PATH), { recursive: true });
  fs.writeFileSync(funStatsService.STORE_PATH, '{not json at all', 'utf8');
  funStatsService.resetCacheForTests();

  assert.deepEqual(funStatsService.listActorStats(), []);
  // And it must still be writable afterwards.
  assert.equal(funStatsService.bumpActorStats('user:alice', { bonksGiven: 1 }).bonksGiven, 1);
});

test('a store with the wrong shape is normalized rather than trusted', () => {
  reset();
  fs.mkdirSync(path.dirname(funStatsService.STORE_PATH), { recursive: true });
  fs.writeFileSync(
    funStatsService.STORE_PATH,
    JSON.stringify({ actors: { 'user:alice': { bonksGiven: 'lots', label: 42 } }, rovers: 'nope' }),
    'utf8',
  );
  funStatsService.resetCacheForTests();

  const stats = funStatsService.getActorStats('user:alice');
  assert.equal(stats.bonksGiven, 0);
  assert.equal(stats.label, '42');
  assert.equal(funStatsService.getRoverPets('rover-1'), 0);
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
