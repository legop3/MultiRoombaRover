export const CONTROL_STREAM_HZ = 50;
export const CONTROL_BIND_PORT = parseInt(process.env.CONTROL_BIND_PORT || '62000', 10);
export const TELEMETRY_BIND_PORT = parseInt(process.env.TELEMETRY_BIND_PORT || '62001', 10);
export const DEFAULT_DEVICE_CONTROL_PORT = parseInt(
  process.env.DEVICE_CONTROL_PORT || '50010',
  10,
);

export const CONTROL_CONSTANTS = {
  MAGIC: 0xAA,
  VERSION: 1,
  ACTIONS: {
    SEEK_DOCK: 0x01,
    PLAY_SONG: 0x02,
    LOAD_SONG: 0x04,
    ENABLE_OI: 0x08,
  },
  MODES: {
    NO_CHANGE: 0,
    PASSIVE: 1,
    SAFE: 2,
    FULL: 3,
  },
  MAX_SPEED_MMPS: 500,
};

export const TELEMETRY_CONSTANTS = {
  MAGIC: 0x55,
  VERSION: 1,
  HEADER_SIZE: 32,
  TRAILER_SIZE: 9,
  SENSOR_BLOB_BYTES: 80,
  MAX_ROBOT_ID_LEN: 16,
};
