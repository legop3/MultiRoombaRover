#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <config.h>

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(100);
    Serial.print("wifi connecting... ");
  }
  Serial.println("WIFI CONNENCTED !!!! :3");

  pinMode(37, OUTPUT);
}

void loop() {
  Serial.println("looping...");
  delay(500);

  digitalWrite(37, HIGH);
  delay(400);
  digitalWrite(37, LOW);
}