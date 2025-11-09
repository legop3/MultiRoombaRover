#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_wifi.h>
#include <cstring>

#include "config.h"
#include "protocol.h"

using namespace mrr;

namespace {

constexpr gpio_num_t kRoombaRxPin = GPIO_NUM_16;
constexpr gpio_num_t kRoombaTxPin = GPIO_NUM_17;
constexpr gpio_num_t kRoombaBrcPin = GPIO_NUM_5;

constexpr uint32_t kControlLoopDelayMs = 5;
constexpr uint32_t kControlTimeoutMs = 250;
constexpr uint32_t kTelemetryIntervalMs = 500;
constexpr uint32_t kSensorRequestTimeoutMs = 75;
constexpr uint32_t kBrcPulseDurationMs = 1000;
constexpr uint32_t kBrcPulsePeriodMs = 60000;

constexpr size_t kTelemetryBufferSize =
    sizeof(TelemetryPacketHeader) + kSensorGroup100Length + sizeof(TelemetryPacketTrailer);

HardwareSerial& kRoombaSerial = Serial2;
WiFiUDP gControlSocket;
WiFiUDP gTelemetrySocket;

IPAddress gServerIp;

TaskHandle_t gControlTaskHandle = nullptr;
TaskHandle_t gTelemetryTaskHandle = nullptr;
TaskHandle_t gBrcTaskHandle = nullptr;

struct ControlState {
  int16_t left_mmps{0};
  int16_t right_mmps{0};
  OiModeRequest requested_mode{OiModeRequest::kNoChange};
  uint8_t actions{0};
  uint8_t song_slot{0};
  uint16_t seq{0};
  uint32_t last_rx_ms{0};
};

ControlState gLatestControl{};
uint16_t gLastAppliedSeq = 0;
uint16_t gDroppedControlPackets = 0;
portMUX_TYPE gControlMux = portMUX_INITIALIZER_UNLOCKED;

uint32_t gLastSensorOkMs = 0;

enum StatusBits : uint8_t {
  kStatusWifiConnected = 0x01,
  kStatusRoombaReady = 0x02,
  kStatusSensorHealthy = 0x04,
};

class RoombaInterface {
 public:
  void begin() {
    serial_ = &kRoombaSerial;
    serial_->begin(115200, SERIAL_8N1, kRoombaRxPin, kRoombaTxPin);
    serial_->setTimeout(30);  // shorter timeout to avoid blocking control loop
  }

  bool ensureStarted() {
    if (!serial_) {
      return false;
    }
    if (ready_) {
      return true;
    }
    sendOpcode(128);  // Start => Passive
    delay(20);
    sendOpcode(131);  // Safe by default
    ready_ = true;
    return true;
  }

  bool setMode(OiModeRequest request) {
    if (!ensureStarted()) {
      return false;
    }
    switch (request) {
      case OiModeRequest::kNoChange:
        return true;
      case OiModeRequest::kPassive:
        return sendOpcode(128);
      case OiModeRequest::kSafe:
        return sendOpcode(131);
      case OiModeRequest::kFull:
        return sendOpcode(132);
    }
    return false;
  }

  bool driveDirect(int16_t left_mmps, int16_t right_mmps) {
    if (!ensureStarted()) {
      return false;
    }
    uint8_t payload[5];
    payload[0] = 145;  // Drive Direct opcode
    payload[1] = static_cast<uint8_t>((right_mmps >> 8) & 0xFF);
    payload[2] = static_cast<uint8_t>(right_mmps & 0xFF);
    payload[3] = static_cast<uint8_t>((left_mmps >> 8) & 0xFF);
    payload[4] = static_cast<uint8_t>(left_mmps & 0xFF);
    return serial_->write(payload, sizeof(payload)) == sizeof(payload);
  }

  bool seekDock() { return ensureStarted() && sendOpcode(143); }
  bool playSong(uint8_t slot) {
    if (!ensureStarted()) {
      return false;
    }
    uint8_t payload[2] = {141, slot};
    return serial_->write(payload, sizeof(payload)) == sizeof(payload);
  }

  bool requestSensors(uint8_t packet_id, uint8_t* buffer, size_t expected_bytes) {
    if (!ensureStarted()) {
      return false;
    }
    serial_->write(142);
    serial_->write(packet_id);
    const size_t read = serial_->readBytes(buffer, expected_bytes);
    return read == expected_bytes;
  }

  bool isReady() const { return ready_; }

 private:
  bool sendOpcode(uint8_t opcode) { return serial_ && serial_->write(opcode) == 1; }

  HardwareSerial* serial_{nullptr};
  bool ready_{false};
};

RoombaInterface gRoomba;

void disableWifiPowerSave() {
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s\\n", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\\n[wifi] retrying...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      start = millis();
    }
  }
  disableWifiPowerSave();
  Serial.printf("\\n[wifi] connected, ip=%s\\n", WiFi.localIP().toString().c_str());
}

IPAddress resolveServerIp() {
  IPAddress ip;
  if (!ip.fromString(CONTROL_SERVER_IP)) {
    Serial.printf("[wifi] invalid CONTROL_SERVER_IP: %s\\n", CONTROL_SERVER_IP);
  }
  return ip;
}

ControlState snapshotControl() {
  portENTER_CRITICAL(&gControlMux);
  ControlState copy = gLatestControl;
  portEXIT_CRITICAL(&gControlMux);
  return copy;
}

void updateControl(const ControlPacket& pkt) {
  ControlState state;
  state.left_mmps = pkt.left_mmps;
  state.right_mmps = pkt.right_mmps;
  state.actions = pkt.actions;
  state.seq = pkt.seq;
  state.song_slot = pkt.song_slot;
  state.last_rx_ms = millis();
  state.requested_mode = static_cast<OiModeRequest>(pkt.oi_mode);
  portENTER_CRITICAL(&gControlMux);
  gLatestControl = state;
  portEXIT_CRITICAL(&gControlMux);
}

void zeroDrive() {
  gRoomba.driveDirect(0, 0);
}

void handleControlApplication(const ControlState& state) {
  const uint32_t now = millis();
  int16_t left = state.left_mmps;
  int16_t right = state.right_mmps;
  const bool stale = (now - state.last_rx_ms) > kControlTimeoutMs;
  if (stale) {
    left = 0;
    right = 0;
  }

  if (state.seq != gLastAppliedSeq) {
    if (state.requested_mode != OiModeRequest::kNoChange) {
      gRoomba.setMode(state.requested_mode);
    } else if (state.actions & kActionEnableOi) {
      gRoomba.ensureStarted();
    }

    if (state.actions & kActionSeekDock) {
      gRoomba.seekDock();
    }
    if (state.actions & kActionPlaySong) {
      gRoomba.playSong(state.song_slot);
    }
    // kActionLoadSong can be added later when song definitions are ready.

    gLastAppliedSeq = state.seq;
  }

  gRoomba.driveDirect(left, right);
}

void controlTask(void*) {
  uint8_t buffer[sizeof(ControlPacket)] = {0};
  ControlPacket newest{};
  bool hasNewest = false;
  for (;;) {
    hasNewest = false;
    while (gControlSocket.parsePacket() >= static_cast<int>(sizeof(ControlPacket))) {
      const int read = gControlSocket.read(buffer, sizeof(ControlPacket));
      if (read != sizeof(ControlPacket)) {
        continue;
      }
      ControlPacket pkt;
      memcpy(&pkt, buffer, sizeof(ControlPacket));
      const uint8_t computed =
          checksum8(reinterpret_cast<const uint8_t*>(&pkt), sizeof(ControlPacket) - 1);
      if (pkt.magic == kControlMagic && pkt.version == kProtocolVersion && computed == pkt.checksum) {
        newest = pkt;
        hasNewest = true;
      } else {
        ++gDroppedControlPackets;
      }
    }

    if (hasNewest) {
      const uint16_t delta = static_cast<uint16_t>(newest.seq - gLastAppliedSeq);
      if (delta != 0 && delta < 0x8000) {
        updateControl(newest);
      }
    }

    handleControlApplication(snapshotControl());
    vTaskDelay(pdMS_TO_TICKS(kControlLoopDelayMs));
  }
}

void telemetryTask(void*) {
  uint8_t buffer[kTelemetryBufferSize];
  uint8_t sensorBlob[kSensorGroup100Length];
  uint16_t telemetrySeq = 0;

  while (WiFi.status() != WL_CONNECTED) {
    vTaskDelay(pdMS_TO_TICKS(250));
  }

  for (;;) {
    TelemetryPacketHeader header;
    memset(&header, 0, sizeof(header));
    header.magic = kTelemetryMagic;
    header.version = kProtocolVersion;
    header.seq = telemetrySeq++;
    header.uptime_ms = millis();
    const ControlState control = snapshotControl();
    header.last_control_age_ms = millis() - control.last_rx_ms;
    header.wifi_rssi_dbm = WiFi.RSSI();
    header.status_bits = 0;
    if (WiFi.status() == WL_CONNECTED) {
      header.status_bits |= kStatusWifiConnected;
    }
    if (gRoomba.isReady()) {
      header.status_bits |= kStatusRoombaReady;
    }

    size_t sensorLen = 0;
    if (gRoomba.requestSensors(100, sensorBlob, kSensorGroup100Length)) {
      sensorLen = kSensorGroup100Length;
      gLastSensorOkMs = millis();
    }
    if (millis() - gLastSensorOkMs < 2000) {
      header.status_bits |= kStatusSensorHealthy;
    }
    header.sensor_bytes = static_cast<uint8_t>(sensorLen);
    const char* robotId = ROOMBA_ID;
    header.robot_id_length = static_cast<uint8_t>(strnlen(robotId, kMaxRobotIdLength));
    memcpy(header.robot_id, robotId, header.robot_id_length);

    TelemetryPacketTrailer trailer;
    memset(&trailer, 0, sizeof(trailer));
    trailer.applied_left_mmps = control.left_mmps;
    trailer.applied_right_mmps = control.right_mmps;
    trailer.last_control_seq = control.seq;
    trailer.dropped_control_packets = gDroppedControlPackets;

    size_t offset = 0;
    memcpy(buffer + offset, &header, sizeof(header));
    offset += sizeof(header);
    if (sensorLen > 0) {
      memcpy(buffer + offset, sensorBlob, sensorLen);
      offset += sensorLen;
    }
    memcpy(buffer + offset, &trailer, sizeof(trailer));
    offset += sizeof(trailer);

    const uint8_t checksum = checksum8(buffer, offset - 1);
    buffer[offset - 1] = checksum;

    if (gServerIp) {
      gTelemetrySocket.beginPacket(gServerIp, TELEMETRY_SERVER_PORT);
      gTelemetrySocket.write(buffer, offset);
      gTelemetrySocket.endPacket();
    }

    vTaskDelay(pdMS_TO_TICKS(kTelemetryIntervalMs));
  }
}

void brcTask(void*) {
  pinMode(kRoombaBrcPin, OUTPUT);
  digitalWrite(kRoombaBrcPin, HIGH);
  for (;;) {
    digitalWrite(kRoombaBrcPin, LOW);
    vTaskDelay(pdMS_TO_TICKS(kBrcPulseDurationMs));
    digitalWrite(kRoombaBrcPin, HIGH);
    vTaskDelay(pdMS_TO_TICKS(kBrcPulsePeriodMs - kBrcPulseDurationMs));
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println("[boot] MultiRoombaRover firmware starting");

  gRoomba.begin();
  connectWifi();
  gServerIp = resolveServerIp();

  gControlSocket.begin(ESP32_CONTROL_PORT);
  gTelemetrySocket.begin(ESP32_TELEMETRY_PORT);

  xTaskCreatePinnedToCore(controlTask, "control", 4096, nullptr, 3, &gControlTaskHandle, APP_CPU_NUM);
  xTaskCreatePinnedToCore(telemetryTask, "telemetry", 4096, nullptr, 2, &gTelemetryTaskHandle, PRO_CPU_NUM);
  xTaskCreatePinnedToCore(brcTask, "brc", 2048, nullptr, 1, &gBrcTaskHandle, APP_CPU_NUM);
}

void loop() {
  // Nothing to do. All work happens inside FreeRTOS tasks.
  vTaskDelay(pdMS_TO_TICKS(1000));
}
