import { TELEMETRY_CONSTANTS } from './constants.js';
import { checksum8 } from './checksum.js';

const BUTTON_BITS = {
  clean: 0x01,
  spot: 0x02,
  dock: 0x04,
  minute: 0x08,
  hour: 0x10,
  day: 0x20,
  schedule: 0x40,
  clock: 0x80,
};

const BUMP_BITS = {
  bumpRight: 0x01,
  bumpLeft: 0x02,
  wheelDropRight: 0x04,
  wheelDropLeft: 0x08,
};

const WHEEL_OVERCURRENT_BITS = {
  sideBrush: 0x01,
  mainBrush: 0x02,
  rightWheel: 0x04,
  leftWheel: 0x08,
};

const CHARGE_SOURCE_BITS = {
  internalCharger: 0x01,
  homeBase: 0x02,
};

const LIGHT_BUMPER_BITS = {
  left: 0x01,
  frontLeft: 0x02,
  centerLeft: 0x04,
  centerRight: 0x08,
  frontRight: 0x10,
  right: 0x20,
};

const STASIS_BITS = {
  toggling: 0x01,
  disabled: 0x02,
};

const boolField = (value, bits) => {
  const result = {};
  for (const [name, mask] of Object.entries(bits)) {
    result[name] = Boolean(value & mask);
  }
  return result;
};

const readUInt16BE = (buf, offset) => buf.readUInt16BE(offset);
const readInt16BE = (buf, offset) => buf.readInt16BE(offset);

function decodeSensorGroup100(buf) {
  if (!buf || buf.length === 0) {
    return null;
  }
  return {
    bumps: boolField(buf.readUInt8(0), BUMP_BITS),
    wall: Boolean(buf.readUInt8(1)),
    cliffLeft: Boolean(buf.readUInt8(2)),
    cliffFrontLeft: Boolean(buf.readUInt8(3)),
    cliffFrontRight: Boolean(buf.readUInt8(4)),
    cliffRight: Boolean(buf.readUInt8(5)),
    virtualWall: Boolean(buf.readUInt8(6)),
    wheelOvercurrents: boolField(buf.readUInt8(7), WHEEL_OVERCURRENT_BITS),
    dirtDetect: buf.readUInt8(8),
    irOpcode: buf.readUInt8(10),
    buttons: boolField(buf.readUInt8(11), BUTTON_BITS),
    distance: readInt16BE(buf, 12),
    angle: readInt16BE(buf, 14),
    chargingState: buf.readUInt8(16),
    voltageMv: readUInt16BE(buf, 17),
    currentMa: readInt16BE(buf, 19),
    temperatureC: buf.readInt8(21),
    batteryChargeMah: readUInt16BE(buf, 22),
    batteryCapacityMah: readUInt16BE(buf, 24),
    wallSignal: readUInt16BE(buf, 26),
    cliffSignals: {
      left: readUInt16BE(buf, 28),
      frontLeft: readUInt16BE(buf, 30),
      frontRight: readUInt16BE(buf, 32),
      right: readUInt16BE(buf, 34),
    },
    chargingSources: boolField(buf.readUInt8(39), CHARGE_SOURCE_BITS),
    oiMode: buf.readUInt8(40),
    songNumber: buf.readUInt8(41),
    songPlaying: Boolean(buf.readUInt8(42)),
    oiStreamPackets: buf.readUInt8(43),
    velocity: readInt16BE(buf, 44),
    radius: readInt16BE(buf, 46),
    velocityRight: readInt16BE(buf, 48),
    velocityLeft: readInt16BE(buf, 50),
    encoderCounts: {
      left: readUInt16BE(buf, 52),
      right: readUInt16BE(buf, 54),
    },
    lightBumper: boolField(buf.readUInt8(56), LIGHT_BUMPER_BITS),
    lightBumpSignals: {
      left: readUInt16BE(buf, 57),
      frontLeft: readUInt16BE(buf, 59),
      centerLeft: readUInt16BE(buf, 61),
      centerRight: readUInt16BE(buf, 63),
      frontRight: readUInt16BE(buf, 65),
      right: readUInt16BE(buf, 67),
    },
    irLeft: buf.readUInt8(69),
    irRight: buf.readUInt8(70),
    motorCurrents: {
      left: readInt16BE(buf, 71),
      right: readInt16BE(buf, 73),
      mainBrush: readInt16BE(buf, 75),
      sideBrush: readInt16BE(buf, 77),
    },
    stasis: boolField(buf.readUInt8(79), STASIS_BITS),
  };
}

export function decodeTelemetry(message) {
  if (message.length < TELEMETRY_CONSTANTS.HEADER_SIZE + TELEMETRY_CONSTANTS.TRAILER_SIZE) {
    throw new Error('telemetry frame too small');
  }
  const expected = checksum8(message, message.length - 1);
  if (expected !== message.readUInt8(message.length - 1)) {
    throw new Error('telemetry checksum mismatch');
  }

  const robotIdLength = Math.min(
    message.readUInt8(15),
    TELEMETRY_CONSTANTS.MAX_ROBOT_ID_LEN,
  );
  const rawRobotId = message.toString(
    'utf8',
    16,
    16 + TELEMETRY_CONSTANTS.MAX_ROBOT_ID_LEN,
  );
  const header = {
    magic: message.readUInt8(0),
    version: message.readUInt8(1),
    seq: message.readUInt16LE(2),
    uptimeMs: message.readUInt32LE(4),
    lastControlAgeMs: message.readUInt32LE(8),
    wifiRssiDbm: message.readInt8(12),
    statusBits: message.readUInt8(13),
    sensorBytes: message.readUInt8(14),
    robotIdLength,
    robotId: rawRobotId.slice(0, robotIdLength),
  };

  if (header.magic !== TELEMETRY_CONSTANTS.MAGIC) {
    throw new Error(`unexpected telemetry magic ${header.magic}`);
  }
  if (header.version !== TELEMETRY_CONSTANTS.VERSION) {
    throw new Error(`unexpected telemetry version ${header.version}`);
  }

  const sensorOffset = TELEMETRY_CONSTANTS.HEADER_SIZE;
  const trailerOffset = message.length - TELEMETRY_CONSTANTS.TRAILER_SIZE;
  if (sensorOffset + header.sensorBytes > trailerOffset) {
    throw new Error('sensor payload overruns buffer');
  }
  const sensorBlob = message.slice(sensorOffset, sensorOffset + header.sensorBytes);

  return {
    header,
    sensors: header.sensorBytes ? decodeSensorGroup100(sensorBlob) : null,
    trailer: {
      appliedLeftMmps: message.readInt16LE(trailerOffset),
      appliedRightMmps: message.readInt16LE(trailerOffset + 2),
      lastControlSeq: message.readUInt16LE(trailerOffset + 4),
      droppedControlPackets: message.readUInt16LE(trailerOffset + 6),
    },
  };
}
