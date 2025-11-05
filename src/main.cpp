#include <Arduino.h>

// Use two GPIOs with onboard-friendly defaults; adjust to match your dev kit.
constexpr gpio_num_t LED1_PIN = GPIO_NUM_2;  // Often labeled "LED_BUILTIN".
constexpr gpio_num_t LED2_PIN = GPIO_NUM_4;

constexpr TickType_t LED1_DELAY = pdMS_TO_TICKS(250);  // 4 Hz blink.
constexpr TickType_t LED2_DELAY = pdMS_TO_TICKS(700);  // ~1.4 Hz blink.

// FreeRTOS tasks must have C linkage-compatible signatures.
void ledTask(void *parameter) {
  const gpio_num_t pin = static_cast<gpio_num_t>(reinterpret_cast<intptr_t>(parameter));
  const TickType_t delay = (pin == LED1_PIN) ? LED1_DELAY : LED2_DELAY;

  pinMode(pin, OUTPUT);

  // Align the first toggle with system tick so the cadence stays consistent.
  TickType_t nextWake = xTaskGetTickCount();

  bool state = false;
  while (true) {
    digitalWrite(pin, state ? HIGH : LOW);
    state = !state;

    // vTaskDelayUntil keeps a steady period even if the loop body jitters.
    vTaskDelayUntil(&nextWake, delay);
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {
    // Give USB CDC boards a moment to enumerate; safe to ignore for pure UART boards.
    delay(10);
  }
  Serial.println("FreeRTOS dual LED blink demo starting up...");

  // The Arduino core already starts the scheduler after setup() returns.
  xTaskCreate(
      ledTask,        // Task function.
      "LED1",         // Label (shows up in diagnostics).
      2048,           // Stack size in words.
      reinterpret_cast<void *>(static_cast<intptr_t>(LED1_PIN)),
      1,              // Priority.
      nullptr);

  xTaskCreate(
      ledTask,
      "LED2",
      2048,
      reinterpret_cast<void *>(static_cast<intptr_t>(LED2_PIN)),
      1,
      nullptr);
}

void loop() {
  // Leave loop() empty; the FreeRTOS tasks do the work.
  vTaskDelay(pdMS_TO_TICKS(1000));
}
