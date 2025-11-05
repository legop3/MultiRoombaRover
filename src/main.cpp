#include <Arduino.h>

// --- Hardware mapping -------------------------------------------------------
// Adjust these pins to match how your level shifter connects the ESP32 to the Roomba.
constexpr int ROBO_UART_RX = 16;        // ESP32 pin receiving Roomba TX (ROI pin 4).
constexpr int ROBO_UART_TX = 17;        // ESP32 pin driving Roomba RX (ROI pin 3).
constexpr gpio_num_t ROBO_BRC_PIN = GPIO_NUM_5;  // GPIO pulsing the BRC line (ROI pin 5).

// FreeRTOS cadences (1 Hz pulse, 150 ms low to ensure Roomba notices).
constexpr TickType_t BRC_PERIOD = pdMS_TO_TICKS(1000);
constexpr TickType_t BRC_LOW_PULSE = pdMS_TO_TICKS(150);

// Simple helper to send an Open Interface command over UART.
void sendRoombaCommand(std::initializer_list<uint8_t> bytes) {
  Serial1.write(bytes.begin(), bytes.size());
  Serial1.flush();  // Ensure command clears the UART FIFO before proceeding.
}

void brcTask(void * /*parameter*/) {
  TickType_t nextWake = xTaskGetTickCount();
  uint32_t pulseCount = 0;

  while (true) {
    // Idle high, pulse low to reset the five-minute sleep timer.
    Serial.printf("[BRC] Pulse #%lu: pulling low\n", static_cast<unsigned long>(pulseCount));
    gpio_set_level(ROBO_BRC_PIN, 0);
    vTaskDelay(BRC_LOW_PULSE);
    gpio_set_level(ROBO_BRC_PIN, 1);
    Serial.printf("[BRC] Pulse #%lu: released high\n", static_cast<unsigned long>(pulseCount));
    pulseCount++;

    vTaskDelayUntil(&nextWake, BRC_PERIOD);
  }
}

void roombaTask(void * /*parameter*/) {
  // Give the Roomba a moment after wake-up before issuing commands.
  vTaskDelay(pdMS_TO_TICKS(500));

  Serial.println("Sending Start (128)...");
  sendRoombaCommand({128});  // Start OI -> Passive mode.
  vTaskDelay(pdMS_TO_TICKS(100));

  Serial.println("Switching to Safe mode (131)...");
  sendRoombaCommand({131});  // Safe gives actuator control with failsafes.
  vTaskDelay(pdMS_TO_TICKS(100));

  Serial.println("Loading a short test song into slot 0 (Song, opcode 140)...");
  // Song format: [140][song #][length][note][duration]...
  // Duration units are 1/64ths of a second; 32 ≈ 0.5 s.
  sendRoombaCommand({140, 0, 1, 69, 32});  // A4 for ~0.5 s.
  vTaskDelay(pdMS_TO_TICKS(100));

  Serial.println("Playing song 0 (Play, opcode 141)...");
  sendRoombaCommand({141, 0});
  vTaskDelay(pdMS_TO_TICKS(1500));  // Allow song to finish.

  Serial.println("Initial song played. Roomba ready for bumper test.");

  // Nothing else to do on this task; park it.
  vTaskDelete(nullptr);
}

void sensorTask(void * /*parameter*/) {
  constexpr TickType_t pollPeriod = pdMS_TO_TICKS(100);  // ~10 Hz polling.
  TickType_t nextWake = xTaskGetTickCount();
  bool bumperActive = false;

  // Allow initialization commands to finish before polling.
  vTaskDelay(pdMS_TO_TICKS(1000));

  while (true) {
    // Request packet 7 (Bumps & Wheel Drops).
    sendRoombaCommand({142, 7});

    uint8_t packet = 0;
    const size_t received = Serial1.readBytes(&packet, 1);
    if (received == 1) {
      Serial.printf("[Sensor] Packet 7 raw byte: 0x%02X\n", packet);
      const bool bumpRight = packet & 0b00000001;
      const bool bumpLeft = packet & 0b00000010;
      const bool wheelDropRight = packet & 0b00000100;
      const bool wheelDropLeft = packet & 0b00001000;
      const bool frontBump = bumpLeft || bumpRight;

      if (wheelDropLeft || wheelDropRight) {
        Serial.printf("[Sensor] Wheel drop detected (L:%d R:%d)\n",
                      wheelDropLeft, wheelDropRight);
      }
      if (frontBump && !bumperActive) {
        Serial.println("Front bumper hit! Playing song 0.");
        sendRoombaCommand({141, 0});
      }
      if (!frontBump && bumperActive) {
        Serial.println("Front bumper released.");
      }
      bumperActive = frontBump;
    } else {
      Serial.println("[Sensor] Timed out waiting for packet 7.");
    }

    vTaskDelayUntil(&nextWake, pollPeriod);
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000) {
    delay(10);
  }
  Serial.println("\nRoomba hardware smoke test starting...");

  // Configure the BRC pin; keep it high (inactive) until the pulse task starts.
  pinMode(static_cast<uint8_t>(ROBO_BRC_PIN), OUTPUT);
  gpio_set_level(ROBO_BRC_PIN, 1);

  // Initialize UART1 for the Roomba Open Interface at its default baud (115200 8N1).
  Serial1.begin(115200, SERIAL_8N1, ROBO_UART_RX, ROBO_UART_TX);
  Serial1.setTimeout(150);  // Enough headroom for sensor replies.
  Serial.println("UART1 configured for Roomba at 115200 8N1.");

  // Launch the tasks that drive the Roomba and keep it awake.
  xTaskCreatePinnedToCore(brcTask, "BrcPulse", 2048, nullptr, 1, nullptr, APP_CPU_NUM);
  xTaskCreatePinnedToCore(roombaTask, "RoombaInit", 4096, nullptr, 1, nullptr, APP_CPU_NUM);
  xTaskCreatePinnedToCore(sensorTask, "SensorPoll", 4096, nullptr, 1, nullptr, APP_CPU_NUM);
}

void loop() {
  // Nothing needed here; FreeRTOS tasks run everything.
  vTaskDelay(pdMS_TO_TICKS(1000));
}
