const HEADER = 0x13;
const CHARGING_STATE = {
  0: 'not charging',
  1: 'reconditioning charging',
  2: 'full charging',
  3: 'trickle charging',
  4: 'waiting',
  5: 'charging fault',
};

const OI_MODES = {
  0: 'off',
  1: 'passive',
  2: 'safe',
  3: 'full',
};

const GROUP100_LAYOUT = [
  { id: 7, key: 'bumpsAndWheelDrops', bytes: 1, parser: parseBumps },
  { id: 8, key: 'wall', bytes: 1, parser: parseBool },
  { id: 9, key: 'cliffLeft', bytes: 1, parser: parseBool },
  { id: 10, key: 'cliffFrontLeft', bytes: 1, parser: parseBool },
  { id: 11, key: 'cliffFrontRight', bytes: 1, parser: parseBool },
  { id: 12, key: 'cliffRight', bytes: 1, parser: parseBool },
  { id: 13, key: 'virtualWall', bytes: 1, parser: parseBool },
  { id: 14, key: 'wheelOvercurrents', bytes: 1, parser: parseWheelCurrents },
  { id: 15, key: 'dirtDetect', bytes: 1, parser: parseUInt },
  { id: 16, key: 'dirtDetectLeft', bytes: 1, parser: parseUInt },
  { id: 17, key: 'infraredCharacterOmni', bytes: 1, parser: parseUInt },
  { id: 18, key: 'buttons', bytes: 1, parser: parseButtons },
  { id: 19, key: 'distanceMm', bytes: 2, parser: parseInt },
  { id: 20, key: 'angleDeg', bytes: 2, parser: parseInt },
  { id: 21, key: 'chargingState', bytes: 1, parser: parseChargingState },
  { id: 22, key: 'voltageMv', bytes: 2, parser: parseUInt },
  { id: 23, key: 'currentMa', bytes: 2, parser: parseInt },
  { id: 24, key: 'batteryTemperatureC', bytes: 1, parser: parseInt },
  { id: 25, key: 'batteryChargeMah', bytes: 2, parser: parseUInt },
  { id: 26, key: 'batteryCapacityMah', bytes: 2, parser: parseUInt },
  { id: 27, key: 'wallSignal', bytes: 2, parser: parseUInt },
  { id: 28, key: 'cliffLeftSignal', bytes: 2, parser: parseUInt },
  { id: 29, key: 'cliffFrontLeftSignal', bytes: 2, parser: parseUInt },
  { id: 30, key: 'cliffFrontRightSignal', bytes: 2, parser: parseUInt },
  { id: 31, key: 'cliffRightSignal', bytes: 2, parser: parseUInt },
  { id: 32, key: 'chargingSourcesAvailable', bytes: 1, parser: parseChargeSources },
  { id: 33, key: 'chargingSourcesReserved', bytes: 2, parser: parseUInt },
  { id: 34, key: 'chargingSources', bytes: 1, parser: parseChargeSources },
  { id: 35, key: 'oiMode', bytes: 1, parser: parseOiMode },
  { id: 36, key: 'songNumber', bytes: 1, parser: parseUInt },
  { id: 37, key: 'songPlaying', bytes: 1, parser: parseBool },
  { id: 38, key: 'streamPacketCount', bytes: 1, parser: parseUInt },
  { id: 39, key: 'requestedVelocity', bytes: 2, parser: parseInt },
  { id: 40, key: 'requestedRadius', bytes: 2, parser: parseInt },
  { id: 41, key: 'requestedRightVelocity', bytes: 2, parser: parseInt },
  { id: 42, key: 'requestedLeftVelocity', bytes: 2, parser: parseInt },
  { id: 43, key: 'encoderCountsLeft', bytes: 2, parser: parseUInt },
  { id: 44, key: 'encoderCountsRight', bytes: 2, parser: parseUInt },
  { id: 45, key: 'lightBumper', bytes: 1, parser: parseLightBumper },
  { id: 46, key: 'lightBumpLeftSignal', bytes: 2, parser: parseUInt },
  { id: 47, key: 'lightBumpFrontLeftSignal', bytes: 2, parser: parseUInt },
  { id: 48, key: 'lightBumpCenterLeftSignal', bytes: 2, parser: parseUInt },
  { id: 49, key: 'lightBumpCenterRightSignal', bytes: 2, parser: parseUInt },
  { id: 50, key: 'lightBumpFrontRightSignal', bytes: 2, parser: parseUInt },
  { id: 51, key: 'lightBumpRightSignal', bytes: 2, parser: parseUInt },
  { id: 52, key: 'infraredCharacterLeft', bytes: 1, parser: parseUInt },
  { id: 53, key: 'infraredCharacterRight', bytes: 1, parser: parseUInt },
  { id: 54, key: 'wheelLeftCurrentMa', bytes: 2, parser: parseInt },
  { id: 55, key: 'wheelRightCurrentMa', bytes: 2, parser: parseInt },
  { id: 56, key: 'mainBrushCurrentMa', bytes: 2, parser: parseInt },
  { id: 57, key: 'sideBrushCurrentMa', bytes: 2, parser: parseInt },
  { id: 58, key: 'stasis', bytes: 1, parser: parseBool },
];

const GROUP100_TOTAL = GROUP100_LAYOUT.reduce((sum, spec) => sum + spec.bytes, 0);

const TOP_LEVEL_PACKETS = {
  100: GROUP100_TOTAL,
  21: 1,
  34: 1,
};

function parseSensorFrame(base64Data) {
  if (!base64Data) return null;
  const buf = Buffer.from(base64Data, 'base64');
  if (buf.length < 4 || buf[0] !== HEADER) {
    return null;
  }
  const nBytes = buf[1];
  if (buf.length < nBytes + 3) {
    return null;
  }
  const payload = buf.slice(2, 2 + nBytes);
  const checksum = buf[2 + nBytes];
  if (!validateChecksum(buf.slice(0, 2 + nBytes + 1), checksum)) {
    return null;
  }
  const decoded = {};
  let offset = 0;
  while (offset < payload.length) {
    const packetId = payload[offset++];
    const size = TOP_LEVEL_PACKETS[packetId];
    if (!size || offset + size > payload.length) {
      return null;
    }
    const segment = payload.slice(offset, offset + size);
    offset += size;
    if (packetId === 100) {
      Object.assign(decoded, decodeGroup100(segment));
    } else if (packetId === 21 && decoded.chargingState == null) {
      decoded.chargingState = parseChargingState(segment);
    } else if (packetId === 34 && decoded.chargingSources == null) {
      decoded.chargingSources = parseChargeSources(segment);
    }
  }
  return decoded;
}

function decodeGroup100(buf) {
  if (buf.length !== GROUP100_TOTAL) {
    return {};
  }
  const values = {};
  let offset = 0;
  for (const spec of GROUP100_LAYOUT) {
    const slice = buf.slice(offset, offset + spec.bytes);
    offset += spec.bytes;
    try {
      values[spec.key] = spec.parser ? spec.parser(slice) : parseUInt(slice);
    } catch (err) {
      values[spec.key] = null;
    }
  }
  return values;
}

function parseBool(buf) {
  return Boolean(buf[0]);
}

function parseUInt(buf) {
  return buf.readUIntBE(0, buf.length);
}

function parseInt(buf) {
  return buf.readIntBE(0, buf.length);
}

function parseBumps(buf) {
  const value = buf[0];
  return {
    bumpRight: Boolean(value & 0x01),
    bumpLeft: Boolean(value & 0x02),
    wheelDropRight: Boolean(value & 0x04),
    wheelDropLeft: Boolean(value & 0x08),
  };
}

function parseWheelCurrents(buf) {
  const value = buf[0];
  return {
    sideBrush: Boolean(value & 0x01),
    mainBrush: Boolean(value & 0x04),
    rightWheel: Boolean(value & 0x08),
    leftWheel: Boolean(value & 0x10),
  };
}

const BUTTON_LABELS = ['clean', 'spot', 'dock', 'minute', 'hour', 'day', 'schedule', 'clock'];
function parseButtons(buf) {
  const v = buf[0];
  const result = {};
  BUTTON_LABELS.forEach((label, idx) => {
    result[label] = Boolean(v & (1 << idx));
  });
  return result;
}

function parseChargingState(buf) {
  const code = buf[0];
  return {
    code,
    label: CHARGING_STATE[code] || 'unknown',
  };
}

function parseChargeSources(buf) {
  const value = buf[0];
  return {
    internalCharger: Boolean(value & 0x01),
    homeBase: Boolean(value & 0x02),
    raw: value,
  };
}

function parseOiMode(buf) {
  const code = buf[0];
  return {
    code,
    label: OI_MODES[code] || 'unknown',
  };
}

const LIGHT_BUMPER_LABELS = ['left', 'frontLeft', 'centerLeft', 'centerRight', 'frontRight', 'right'];
function parseLightBumper(buf) {
  const value = buf[0];
  const obj = {};
  LIGHT_BUMPER_LABELS.forEach((label, idx) => {
    obj[label] = Boolean(value & (1 << idx));
  });
  return obj;
}

function validateChecksum(frame, checksum) {
  let sum = 0;
  for (const byte of frame) {
    sum = (sum + byte) & 0xff;
  }
  return (sum & 0xff) === 0;
}

module.exports = {
  parseSensorFrame,
  CHARGING_STATE,
};
