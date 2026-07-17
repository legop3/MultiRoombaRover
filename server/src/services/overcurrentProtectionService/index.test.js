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
  // The hardware event is visible immediately even though the grace region
  // correctly leaves the command cap at full output.
  assert.equal(snapshot.status, 'overcurrent');
});

test('persistent stalled-wheel overcurrent scales both wheels and then stops drive', () => {
  const { service, issued } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 200 },
  });

  for (let step = 0; step <= 12; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 0, right: 200 },
    }), start + step * 100);
  }

  /*
    The first 400 ms establish that the wheel is making no net progress. Once
    classified, the faster stalled rate should approach—but not yet cross—the
    hard-stop boundary at 1.2 seconds.
  */
  assert.equal(service.getPublicState('rover').drive.blocked, false);
  service.processTelemetry('rover', makeSensors({
    wheelOvercurrents: { leftWheel: true },
    wheelSpeedsMmPerSecond: { left: 0, right: 200 },
  }), start + 1300);

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

test('encoder wobble around zero is classified as a full stall', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  for (let step = 0; step <= 13; step += 1) {
    const wobbleSpeed = step % 2 === 0 ? 10 : -9;
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: wobbleSpeed },
    }), start + step * 100);
  }

  const snapshot = service.getPublicState('rover');
  assert.equal(snapshot.motors.leftWheel.classification, 'stalled');
  assert.equal(snapshot.motors.leftWheel.stallFactor, 1);
  assert.equal(snapshot.drive.blocked, true);
});

test('overcurrent while a wheel keeps moving accumulates at the slower rate', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  for (let step = 0; step <= 20; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 240 },
    }), start + step * 100);
  }

  const snapshot = service.getPublicState('rover');
  assert.equal(snapshot.motors.leftWheel.classification, 'moving');
  assert.equal(snapshot.motors.leftWheel.stallFactor, 0);
  assert.equal(snapshot.drive.blocked, false);
  assert.ok(snapshot.motors.leftWheel.stress < 0.6);
});

test('partial wheel progress produces an intermediate stall factor', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  for (let step = 0; step <= 5; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 105 },
    }), start + step * 100);
  }

  const motor = service.getPublicState('rover').motors.leftWheel;
  assert.equal(motor.classification, 'partial');
  assert.ok(motor.stallFactor > 0 && motor.stallFactor < 1);
});

test('missing wheel speed remains unknown instead of becoming a full stall', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  for (let step = 0; step <= 20; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: null },
    }), start + step * 100);
  }

  const snapshot = service.getPublicState('rover');
  assert.equal(snapshot.motors.leftWheel.measuredSpeed, null);
  assert.equal(snapshot.motors.leftWheel.classification, 'unknown');
  assert.equal(snapshot.motors.leftWheel.stallFactor, 0);
  assert.equal(snapshot.drive.blocked, false);
});

test('wheel comparison follows scaled output and resets after reversal', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });

  for (let step = 0; step <= 6; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 0 },
    }), start + step * 100);
  }
  const scaled = service.getPublicState('rover').motors.leftWheel.commandedSpeed;
  assert.ok(scaled < 300);

  service.protectCommand('rover', 'drive', {
    driveDirect: { left: -300, right: -300 },
  });
  const reversed = service.processTelemetry('rover', makeSensors({
    wheelOvercurrents: { leftWheel: true },
    wheelSpeedsMmPerSecond: { left: -250 },
  }), start + 700);
  assert.equal(reversed.motors.leftWheel.classification, 'unknown');
  assert.equal(reversed.motors.leftWheel.progressRatio, null);
});

test('a stopped drive stays blocked until both clear time and neutral are observed', () => {
  const { service } = createHarness();
  const start = Date.now();
  service.protectCommand('rover', 'drive', {
    driveDirect: { left: 300, right: 300 },
  });
  for (let step = 0; step <= 13; step += 1) {
    service.processTelemetry('rover', makeSensors({
      wheelOvercurrents: { leftWheel: true },
      wheelSpeedsMmPerSecond: { left: 0 },
    }), start + step * 100);
  }

  for (let step = 14; step <= 28; step += 1) {
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
