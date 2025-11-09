#pragma once

// Copy this file to include/config.h and fill in your network + server settings.

#define WIFI_SSID "YourNetworkName"
#define WIFI_PASSWORD "YourNetworkPassword"

// UDP server that issues control packets and receives telemetry.
#define CONTROL_SERVER_IP "192.168.1.50"
#define CONTROL_SERVER_PORT 62000
#define TELEMETRY_SERVER_PORT 62001

// Local ports on the ESP32. Keeping them distinct simplifies sniffing.
#define ESP32_CONTROL_PORT 50010
#define ESP32_TELEMETRY_PORT 50011

// Friendly name to embed in telemetry.
#define ROOMBA_ID "roomba-alpha"
