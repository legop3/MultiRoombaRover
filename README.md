# Multi Roomba Rover

a remake of my RoombaRover project with a decentralized and embedded approach

## Hardware stack

On each roomba:
- an esp32
  - a level shifter
  - DONT FORGET THE BRC PIN PULSE
- a power supply
- an openIPC camera
  - USB wifi card
  - microphone
  - speaker
- MAYBE a master relay which can be turned off programatically to save the roomba from discharging. based on battery voltage plus urgent battery #?

## Current software layout

```
.
├── include/
│   ├── config.example.h    // copy to config.h with your Wi-Fi + server settings
│   └── protocol.h          // shared packet layout (control + telemetry)
├── src/main.cpp            // ESP32 firmware entrypoint (PlatformIO)
└── server/
    ├── package.json        // Node.js server + Socket.IO web UI
    ├── robots.example.json // copy/edit to robots.json for your fleet
    ├── src/                // UDP relay + telemetry decoder
    └── public/             // barebones HTML/JS UI
```

### Firmware quickstart

1. `cp include/config.example.h include/config.h` and fill in:
   - `WIFI_SSID` / `WIFI_PASSWORD`
   - `CONTROL_SERVER_IP` (Node server host)
   - `ROOMBA_ID` (unique per robot; must match the server entry)
   - tweak ports only if you have a reason.
2. Flash with PlatformIO: `pio run -t upload` (env `esp32s3`).
3. The firmware spawns three FreeRTOS tasks:
   - control loop (5 ms cadence) – consumes UDP control packets and drives the Create 2 via UART pins 16/17. Wheel commands decay to zero if no packets arrive for 250 ms.
   - telemetry loop (500 ms cadence) – polls sensor group 100, appends Wi-Fi/LRU stats, and streams UDP telemetry to the server.
   - BRC maintenance – pulses GPIO5 low for 1 s every minute to keep the robot awake.

### Server + web UI quickstart

1. `cd server`
2. `cp robots.example.json robots.json` and add one entry per robot. Only the `id` is required (must match `ROOMBA_ID` in the firmware); override `controlPort`/`maxWheelSpeed` if you deviate from defaults.
3. Install deps: `npm install`
4. Run in dev mode: `npm run dev`
   - HTTP + Socket.IO on `http://localhost:8080`
   - UDP control bind port `62000`, telemetry bind port `62001` (override with env vars).
5. Open the web UI:
   - select a robot
   - drive with WASD (left/right wheel mm/s shown in telemetry summary)
   - buttons issue Safe/Full/Enable-OI/Dock commands
   - sensor list renders the decoded Create 2 group-100 payload plus ESP stats

Each ESP32 announces itself as soon as it streams telemetry, so the server automatically learns the robot’s current IP address (no static DHCP entries required). If you do know a static IP, you can still set `deviceHost` in `robots.json` and the server will use it immediately.

UDP streams stay simple:
- server -> ESP32: fixed 12-byte control packet blasted at 50 Hz per robot
- ESP32 -> server: framed telemetry header + raw sensor group 100 + trailer (CRC-8)
