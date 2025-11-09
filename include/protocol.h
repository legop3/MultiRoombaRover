#pragma once

#include <stdint.h>
#include <type_traits>

#include <Arduino.h>

namespace mrr {

constexpr uint8_t kControlMagic = 0xAA;
constexpr uint8_t kTelemetryMagic = 0x55;
constexpr uint8_t kProtocolVersion = 1;
constexpr size_t kSensorGroup100Length = 80;
constexpr size_t kMaxRobotIdLength = 16;

enum class OiModeRequest : uint8_t {
  kNoChange = 0,
  kPassive = 1,
  kSafe = 2,
  kFull = 3,
};

enum ActionBits : uint8_t {
  kActionSeekDock = 0x01,
  kActionPlaySong = 0x02,
  kActionLoadSong = 0x04,
  kActionEnableOi = 0x08,
};

struct __attribute__((packed)) ControlPacket {
  uint8_t magic{kControlMagic};
  uint8_t version{kProtocolVersion};
  uint16_t seq{};
  int16_t left_mmps{};
  int16_t right_mmps{};
  uint8_t oi_mode{};
  uint8_t actions{};
  uint8_t song_slot{};
  uint8_t checksum{};
};

static_assert(sizeof(ControlPacket) == 12, "ControlPacket must remain packed");

struct __attribute__((packed)) TelemetryPacketHeader {
  uint8_t magic{kTelemetryMagic};
  uint8_t version{kProtocolVersion};
  uint16_t seq{};
  uint32_t uptime_ms{};
  uint32_t last_control_age_ms{};
  int8_t wifi_rssi_dbm{};
  uint8_t status_bits{};
  uint8_t sensor_bytes{};
  uint8_t robot_id_length{};
  char robot_id[kMaxRobotIdLength]{};
};

struct __attribute__((packed)) TelemetryPacketTrailer {
  int16_t applied_left_mmps{};
  int16_t applied_right_mmps{};
  uint16_t last_control_seq{};
  uint16_t dropped_control_packets{};
  uint8_t checksum{};
};

inline uint8_t checksum8(const uint8_t* data, size_t len) {
  uint32_t sum = 0;
  for (size_t i = 0; i < len; ++i) {
    sum += data[i];
  }
  return static_cast<uint8_t>(sum & 0xFF);
}

template <typename T>
inline uint8_t checksumPayload(const T& pod) {
  static_assert(std::is_trivially_copyable<T>::value, "checksum payload must be POD");
  return checksum8(reinterpret_cast<const uint8_t*>(&pod), sizeof(T));
}

template <typename T>
inline uint8_t checksumExcludingLastByte(const T& pod) {
  static_assert(std::is_trivially_copyable<T>::value, "checksum payload must be POD");
  return checksum8(reinterpret_cast<const uint8_t*>(&pod), sizeof(T) - 1);
}

}  // namespace mrr
