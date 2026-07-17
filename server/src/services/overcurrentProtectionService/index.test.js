// Overcurrent Protection Service Tests
// Purpose: Verifies stress integration, administrator bypass, neutral recovery, and independent brush limiting.
// Scope: Exercises the service as a pure state machine with an injected command sink; no rover or socket process is started.

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOvercurrentProtectionService } = require('./index');

function makeSensors(overrides = {}) {
  return {
    wheelOvercurrents: {
      leftWheel: false,
      rightWheel: false,
      mainBrush: false,
      sideBrush: false,
      ...(overrides.wheelOvercurrents || {}),
    },
    wheelSpeedsMmPerSecond: {
      left: 300,
      right: 300,
      ...(overrides.wheelSpeedsMmPerSecond || {}),
    },
  };
}

function createHarness(config = {}) {
  const issued = [];
  const service = createOvercurrentProtectionService({
    config,
    issueCommand: (roverId, payload) => issued.push({ roverId, payload }),
  });
  return { service, issued };
}

test('a short stalled-wheel spike remains inside the grace region', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  service.processTelemetry('rover', makeSensors({
    wheelOvercurrents: { leftWheel: true },
    wheelSpeedsMmPerSecond: { left: 0 },
  }), start);
  const snapshot = service.processTelemetry('rover', makeSensors({
    wheelOvercurrents: { leftWheel: true },
    wheelSpeedsMmPerSecond: { left: 0 },
  }), start + 100);

  assert.equal(snapshot.motors.leftWheel.stress, 0.025);
  assert.equal(snapshot.motors.leftWheel.cap, 1);
  assert.equal(snapshot.status, 'idle');
});

test('persistent stalled-wheel overcurrent scales both wheels and then stops drive', () => {
  const { service, issued } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 200 },
  });

  for (let step = 0; step <= 39; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 0, right: 200 },
    }), start + step * 100);
  }

  /*
    Thirty-nine accumulated 100 ms intervals represent 3.9 seconds at the
    maximum 0.25/s rate. The drive must still be available immediately before
    the intended four-second hard-stop boundary.
  */
  assert.equal(service.getPublicState('rover').drive.blocked, false);
  service.processTelemetry('rover', makeSensors({
    wheelOvercurrents: { leftWheel: true },
    wheelSpeedsMmPerSecond: { left: 0, right: 200 },
  }), start + 4000);

  const snapshot = service.getPublicState('rover');
  assert.equal(snapshot.status, 'stopped');
  assert.equal(snapshot.drive.blocked, true);
  assert.equal(snapshot.drive.requiresNeutral, true);
  assert.equal(snapshot.drive.stopReason, 'leftWheel');
  assert.deepEqual(issued.at(-1), {
    roverId: 'rover',
    payload: { type: 'drive', driveDirect: { left: 0, right: 0 } },
  });

  /*
    Before the hard stop, any rate-limited drive update must use one shared cap.
    This preserves the requested curve instead of driving the healthy wheel at
    full output around the mechanically obstructed side.
  */
  const scaledDrive = issued.find((entry) => entry.payload.type === 'drive'
    && entry.payload.driveDirect.left > 0);
  assert.ok(scaledDrive);
  const leftScale = scaledDrive.payload.driveDirect.left / 300;
  const rightScale = scaledDrive.payload.driveDirect.right / 200;
  /*
    Motor commands are integers, so applying one shared fractional cap can
    round the two differently sized wheel commands by different sub-unit
    amounts. A one-percent tolerance verifies the shared curve without
    pretending integer transport preserves an exact floating-point ratio.
  */
  assert.ok(Math.abs(leftScale - rightScale) < 0.01);
});

test('administrator commands and telemetry bypass all enforcement', () => {
  const { service, issued } = createHarness({ outputRateMs: 0 });
  const start = Date.now();
  const command = service.protectCommand('rover', 'drive', {
    driveDirect: { left: 500, right: -500 },
  }, { bypassed: true });

  for (let step = 0; step <= 20; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true, rightWheel: true },
      wheelSpeedsMmPerSecond: { left: 0, right: 0 },
    }), start + step * 100);
  }

  const snapshot = service.getPublicState('rover');
  assert.deepEqual(command.driveDirect, { left: 500, right: -500 });
  assert.equal(snapshot.status, 'bypassed');
  assert.equal(snapshot.bypassed, true);
  assert.equal(snapshot.motors.leftWheel.stress, 0);
  assert.equal(snapshot.motors.rightWheel.stress, 0);
  assert.equal(snapshot.drive.blocked, false);
  assert.equal(issued.length, 0);
});

test('a stopped drive stays blocked until both clear time and neutral are observed', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });
  for (let step = 0; step <= 40; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 0 },
    }), start + step * 100);
  }

  for (let step = 41; step <= 61; step += 1) {
    service.processTelemetry('rover', makeSensors(), start + step * 100);
  }
  assert.equal(service.getPublicState('rover').drive.blocked, true);

  const heldCommand = service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });
  assert.deepEqual(heldCommand.driveDirect, { left: 0, right: 0 });

  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 0, right: 0 },
  });
  assert.equal(service.getPublicState('rover').drive.blocked, false);

  const resumed = service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });
  assert.deepEqual(resumed.driveDirect, { left: 300, right: 300 });
});

test('brush stress limits only the brush that reports overcurrent', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'motors', {
    motorPwm: { main: 100, side: 100, vacuum: 100 },
  });
  for (let step = 0; step <= 4; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { mainBrush: true },
    }), start + step * 100);
  }

  const protectedCommand = service.protectCommand('rover', 'motors', {
    motorPwm: { main: 100, side: 100, vacuum: 100 },
  });
  assert.ok(protectedCommand.motorPwm.main < 100);
  assert.equal(protectedCommand.motorPwm.side, 100);
  assert.equal(protectedCommand.motorPwm.vacuum, 100);
});
