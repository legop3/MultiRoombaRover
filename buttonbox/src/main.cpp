#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <config.h>

// button pin defs
const int buttonPins[] = {15, 16, 17, 18};
const int buttonCount = sizeof(buttonPins) / sizeof(buttonPins[0]);
const int beeperPin = 13;

// Using INPUT_PULLUP means idle = HIGH, pressed = LOW (button to GND).
const int buttonPressedState = LOW;
const unsigned long debounceMs = 40;
const int toneDurationMs = 90;

// One tone per button (1-4).
const int buttonTonesHz[buttonCount] = {262, 330, 392, 523};

int lastStableState[buttonCount];
int lastReading[buttonCount];
unsigned long lastDebounceTime[buttonCount];

void PlayButtonTone(int buttonNumber) {
  if (buttonNumber < 1 || buttonNumber > buttonCount) {
    return;
  }

  int frequencyHz = buttonTonesHz[buttonNumber - 1];
  tone(beeperPin, frequencyHz, toneDurationMs);
}

// button request function
bool SendButtonPressRequest(int buttonNumber) {
  Serial.println("attempting to send button press");
  bool success = false;
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "text/plain");

    int httpResponseCode = http.POST(String(buttonNumber));

    if (httpResponseCode > 0) {
      Serial.println("http response code: ");
      Serial.print(httpResponseCode);
      Serial.println(http.getString());
      success = true;
    } else {
      Serial.println("HTTP ERROR!!! ");
      Serial.print(httpResponseCode);
      success = false;
    }
    http.end();

  } else {
    Serial.println("Not ocnnectec to wifi! cant send request!");
  }
  return success;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(100);
    Serial.print("wifi connecting... ");
  }
  Serial.println("WIFI CONNENCTED !!!! :3");

  for (int i = 0; i < buttonCount; i++) {
    pinMode(buttonPins[i], INPUT_PULLUP);
    int initial = digitalRead(buttonPins[i]);
    lastStableState[i] = initial;
    lastReading[i] = initial;
    lastDebounceTime[i] = 0;
  }

  pinMode(beeperPin, OUTPUT);
  noTone(beeperPin);
}

void loop() {
  unsigned long now = millis();

  for (int i = 0; i < buttonCount; i++) {
    int reading = digitalRead(buttonPins[i]);

    if (reading != lastReading[i]) {
      lastDebounceTime[i] = now;
    }

    if ((now - lastDebounceTime[i]) > debounceMs) {
      if (reading != lastStableState[i]) {
        lastStableState[i] = reading;

        // Trigger once on press edge.
        if (reading == buttonPressedState) {
          if (SendButtonPressRequest(i + 1)) {
            PlayButtonTone(i + 1);
          }
        }
      }
    }

    lastReading[i] = reading;
  }

  delay(5);
}
