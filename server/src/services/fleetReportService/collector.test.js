// Fleet Report Collector Tests
// Purpose: Verifies signed-current integration, gap rejection, and high-rate command noise reduction independently of SQLite.
// Scope: Uses an in-memory storage double so tests exercise collection policy without touching development data files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollector } = require('./collector');

function makeHarness() {
  const writes = { events: [], minutes: [], sessions: [] };
  const storage = {
    insertEvent(event) { writes.events.push(event); return { changes: 1 }; },
    upsertMinute(minute) { writes.minutes.push({ ...minute }); return { changes: 1 }; },
    insertBatterySession(session) { writes.sessions.push({ ...session }); return { changes: 1 }; },
  };
  const collector = createCollector({
    storage,
    logger: { warn() {} },
    maximumIntegrationGapMs: 5000,
    minimumCapacityTestDepthPercent: 60,
  });
  return { collector, writes };
}

function sensors(overrides = {}) {
  return {
    currentMa: -3600,
    voltageMv: 14500,
    batteryTemperatureC: 25,
    batteryChargeMah: 2000,
    batteryCapacityMah: 3000,
    chargingState: { code: 0, label: 'not charging' },
    chargingSources: { homeBase: false, internalCharger: false },
    ...overrides,
  };
}

test('integrates signed battery current while excluding long telemetry gaps', () => {
  const { collector } = makeHarness();
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    collector.collectSensor({ roverId: 'alpha', sensors: sensors() });
    now += 1000;
    collector.collectSensor({ roverId: 'alpha', sensors: sensors() });
    now += 6000;
    collector.collectSensor({ roverId: 'alpha', sensors: sensors() });
    const live = collector.getLiveState()[0].minute;
    // -3600 mA for one valid second is exactly one discharged mAh. The six
    // second interval exceeds the configured integration gap and adds no
    // fictional throughput.
    assert.equal(live.dischargedMah, 1);
    assert.equal(live.chargedMah, 0);
    assert.equal(live.gapCount, 1);
    assert.equal(live.coverageMs, 1000);
  } finally {
    Date.now = originalNow;
  }
});

test('integrates watt-hours and classifies energy with existing odometer speed', () => {
  const { collector } = makeHarness();
  const originalNow = Date.now;
  let now = 1_500_000;
  Date.now = () => now;
  try {
    collector.collectSensor({
      roverId: 'alpha',
      sensors: sensors({ wheelSpeedsMmPerSecond: { left: 200, right: 200, center: 200 } }),
    });
    now += 1000;
    collector.collectSensor({
      roverId: 'alpha',
      sensors: sensors({ wheelSpeedsMmPerSecond: { left: 200, right: 200, center: 200 } }),
    });
    now += 1000;
    collector.collectSensor({
      roverId: 'alpha',
      sensors: sensors({ wheelSpeedsMmPerSecond: { left: 0, right: 0, center: 0 } }),
    });
    const live = collector.getLiveState()[0].minute;
    /*
      A 14.5 V, 3.6 A discharge is 52.2 W. Two one-second intervals therefore
      consume 52.2 / 1800 Wh; the first is moving and the second stationary.
      This verifies that the collector uses odometer speed rather than deriving
      movement from commands.
    */
    assert.ok(Math.abs(live.dischargedWh - (52.2 / 1800)) < 1e-12);
    assert.ok(Math.abs(live.movingDischargedWh - (52.2 / 3600)) < 1e-12);
    assert.ok(Math.abs(live.stationaryDischargedWh - (52.2 / 3600)) < 1e-12);
    assert.equal(live.movingMs, 1000);
    assert.equal(live.maximumSpeedMmPerSecond, 200);
  } finally {
    Date.now = originalNow;
  }
});

test('uses cumulative odometer distance without recalculating encoder movement', () => {
  const { collector } = makeHarness();
  collector.collectOdometer({ roverId: 'alpha', odometer: { totalMm: 1000, updatedAt: 4_000_000 } });
  collector.collectOdometer({ roverId: 'alpha', odometer: { totalMm: 1250, updatedAt: 4_001_000 } });
  const live = collector.getLiveState()[0].minute;
  assert.equal(live.distanceMm, 250);
});

test('aggregates drive commands into minute counters instead of event noise', () => {
  const { collector, writes } = makeHarness();
  const originalNow = Date.now;
  Date.now = () => 2_000_000;
  try {
    for (let index = 0; index < 100; index += 1) {
      collector.collectCommand({ roverId: 'alpha', type: 'drive', outcome: 'issued', ts: 2_000_000 + index });
    }
    collector.collectCommand({ roverId: 'alpha', type: 'drive', outcome: 'rejected', error: 'safety cooldown' });
    collector.collectCommand({ roverId: 'alpha', type: 'horn', outcome: 'issued' });
    const live = collector.getLiveState()[0].minute;
    assert.equal(live.commandCount, 102);
    assert.equal(live.driveCommandCount, 101);
    assert.equal(live.rejectedCommandCount, 1);
    assert.equal(writes.events.length, 2);
    assert.deepEqual(writes.events.map((event) => event.type), ['command.rejected', 'command.issued']);
  } finally {
    Date.now = originalNow;
  }
});

test('preserves chat content in structured global events', () => {
  const { collector, writes } = makeHarness();
  collector.collectEvent({
    source: 'chat',
    type: 'chat:message',
    ts: 3_000_000,
    payload: { text: 'hello fleet history', nickname: 'Otter' },
  });
  assert.equal(writes.events.length, 1);
  assert.equal(writes.events[0].payload.text, 'hello fleet history');
  assert.equal(writes.events[0].visibility, 'global');
});
