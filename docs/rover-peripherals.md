# Boot-discovered rover peripherals

This document defines the system for attaching self-describing ESP32 peripherals to a rover over USB. A peripheral advertises a small ordered set of controls, the web UI renders those controls automatically, and the current driver can use them without adding device-specific configuration to the rover or server.

The design deliberately stays small:

- Firmata is the only serial protocol.
- Standard Firmata commands operate ordinary digital, PWM, and servo outputs.
- One Firmata user feature advertises controls and invokes custom ESP32 callbacks.
- A peripheral can expose sliders, buttons, number inputs, and text inputs.
- Controls appear in one vertical column in the order registered by the ESP32 program.
- Anyone who can currently drive the rover can use its peripheral controls.
- Peripherals are discovered once when `roverd` starts; changing one requires restarting the rover.
- ESP32 firmware is built and uploaded with PlatformIO.
- The same firmware supports CH340/CP210x USB-to-UART boards and native USB CDC boards.
- There is no peripheral configuration in the rover configuration file.
- There is no separate rover-peripheral protocol version.

This document is both the design contract and implementation guide. The PlatformIO firmware library, reference sketch, focused Go Firmata client, hardware probe, boot-time daemon discovery, fixed inventory, generic output dispatch, built-in hardware backend selection, rover WebSocket message shapes, server roster forwarding, and shared HUD renderer now exist.

## System boundary

The complete path is:

```text
ESP32 peripheral
    │
    │ USB serial carrying Firmata
    ▼
roverd peripheral manager
    │
    │ existing rover WebSocket
    ▼
server rover state and command authorization
    │
    │ existing Socket.IO session and command paths
    ▼
driver web UI
```

Each layer has one responsibility:

- The ESP32 declares controls and implements custom hardware behavior.
- `roverd` discovers USB devices, speaks Firmata, and translates between Firmata and rover WebSocket messages.
- The server stores the live peripheral list and permits control only for a socket that can drive the rover.
- The browser renders the declared controls and sends user changes to the server.

The server and browser do not know how a peripheral is wired. A control can operate a servo, light, motor, display, addressable LED strip, or an arbitrary sequence because the hardware mapping stays either in the Firmata output declaration or in the ESP32 callback.

## Firmata model

Firmata already supplies serial framing, firmware discovery, capability queries, pin-mode commands, digital output, PWM, servo output, I2C, and its SysEx extension mechanism. The peripheral system uses those capabilities instead of defining another serial transport.

Two kinds of controls coexist on the same Firmata connection.

### Standard Firmata controls

A standard control identifies a Firmata output mode and pin. `roverd` translates UI values directly into normal Firmata commands.

Examples:

- A servo slider sets a pin to `SERVO` mode and writes the selected angle.
- A brightness slider sets a pin to `PWM` mode and writes the selected duty value.
- A toggle button sets a pin to digital output and writes `HIGH` or `LOW`.
- A momentary digital button writes `HIGH` on press and `LOW` on release.

The ESP32 application does not need a callback for these controls because its normal Firmata implementation performs the output operation.

### Custom function controls

A custom control is registered with an ESP32 callback. The control description identifies it by its string control ID. When `roverd` receives a value from the browser, it sends that ID and value through the rover-peripheral Firmata feature. The ESP32 library finds the registered control and invokes its callback.

Custom functions can do anything the ESP32 program can do, including:

- Run a coordinated servo or motor sequence.
- Start or stop a light-strip animation.
- Send text to a display.
- Operate hardware through an ESP32-specific library.
- Change several outputs as one operation.
- Update state used by non-blocking work in `updateRoverPeripheral()`.

The visible control name is also its string wire identifier, so authors provide
one meaningful name instead of maintaining a second hidden ID. They do not
assign numeric action IDs. Firmata necessarily uses a numeric SysEx feature byte
internally, but that is an implementation detail hidden by the package.

## Firmata user feature

Firmata reserves SysEx feature IDs `0x01` through `0x0F` for user-defined features. MultiRoombaRover uses `0x01` for its rover-peripheral feature.

Every feature message has normal Firmata SysEx framing:

```text
0xF0 0x01 <operation> <payload> 0xF7
```

Where:

- `0xF0` is `START_SYSEX`.
- `0x01` is the project-local rover-peripheral feature.
- `operation` selects one of the messages below.
- `payload` contains only 7-bit Firmata data bytes.
- `0xF7` is `END_SYSEX`.

The feature operations are internal library constants:

| Operation | Direction | Purpose |
| --- | --- | --- |
| `DESCRIBE` | `roverd` to ESP32 | Request the current peripheral description. |
| `DESCRIPTION` | ESP32 to `roverd` | Return the peripheral name and ordered controls. |
| `CONTROL` | `roverd` to ESP32 | Deliver a value to a custom control callback. |

The first implementation does not need additional operations. Standard controls continue using standard Firmata messages and therefore do not use `CONTROL`.

### Text encoding

The `DESCRIPTION` and `CONTROL` payloads contain compact JSON because the data is naturally structured and JSON is straightforward to inspect while developing firmware and `roverd`.

Firmata requires every byte between `START_SYSEX` and `END_SYSEX` to have its most significant bit clear. The library therefore encodes each UTF-8 JSON byte as two 7-bit bytes:

```text
encoded byte 1 = source byte & 0x7f
encoded byte 2 = (source byte >> 7) & 0x01
```

The receiver combines each pair:

```text
source byte = encoded byte 1 | (encoded byte 2 << 7)
```

Peripheral authors never perform this encoding themselves. It belongs inside the ESP32 `RoverPeripheral` package and the Go Firmata client used by `roverd`.

ConfigurableFirmata's ESP32 parser accepts 252 bytes inside one incoming SysEx frame, including the feature and operation bytes. `CONTROL` values are not chunked in this deliberately simple design. The Go client checks the fully encoded message before writing it and returns an error if a particular control value cannot fit, rather than sending a frame the ESP32 would discard. Normal numeric, boolean, and short text controls fit comfortably; a text control's configured length should reflect this transport constraint.

## Peripheral description

The ESP32 library builds this description from the controls registered in `configureRoverPeripheral()`. The order of the `controls` array is the registration order and is also the UI order.

An example description is:

```json
{
  "name": "Example peripheral",
  "controls": [
    {
      "id": "Servo position",
      "type": "slider",
      "name": "Servo position",
      "min": 0,
      "max": 180,
      "output": {
        "type": "servo",
        "pin": 14
      }
    },
    {
      "id": "Light brightness",
      "type": "slider",
      "name": "Light brightness",
      "min": 0,
      "max": 255,
      "output": {
        "type": "pwm",
        "pin": 17
      }
    },
    {
      "id": "Special action",
      "type": "button",
      "name": "Special action",
      "mode": "momentary",
      "output": {
        "type": "custom"
      }
    }
  ]
}
```

### Peripheral fields

| Field | Meaning |
| --- | --- |
| `name` | Human-readable heading shown above the peripheral's controls. |
| `controls` | Ordered array of controls exposed by the peripheral. |

The startup USB connection is the identity of a peripheral for the lifetime of the `roverd` process. `roverd` assigns each discovered connection a process-local peripheral ID and includes that ID in the rover hello. The ESP32 does not need registration, a serial number, or an entry in rover configuration. Restarting `roverd` rebuilds the complete inventory and may assign different process-local IDs.

### Fields shared by every control

| Field | Meaning |
| --- | --- |
| `id` | String used to identify the control within this peripheral. It must be unique within the description. |
| `type` | One of `slider`, `button`, `number`, or `text`. |
| `name` | Human-readable label displayed by the web UI. |
| `output` | Describes whether `roverd` uses standard Firmata or invokes the registered custom callback. |

### Slider

A slider contains numeric `min` and `max` values:

```json
{
  "id": "armPosition",
  "type": "slider",
  "name": "Arm position",
  "min": 0,
  "max": 180,
  "output": {
    "type": "servo",
    "pin": 14
  }
}
```

The browser displays a range input. Values are numbers and are constrained to the declared range before being sent. The initial design uses whole-number values; a separate step field is unnecessary.

### Button

A button contains a `mode` of `toggle` or `momentary`:

```json
{
  "id": "lights",
  "type": "button",
  "name": "Lights",
  "mode": "toggle",
  "output": {
    "type": "digital",
    "pin": 18
  }
}
```

Toggle behavior:

- The first activation sends `true`.
- The next activation sends `false`.
- The browser displays the current local on/off value.

Momentary behavior:

- Press sends `true`.
- Release sends `false`.
- Pointer cancellation, loss of capture, or component unmount also sends `false` when a press is active, so a momentary control is not left logically held.
- A custom callback may react to both values or ignore release when it implements a one-shot action.

### Number input

A number input contains numeric `min` and `max` values:

```json
{
  "id": "motorSpeed",
  "type": "number",
  "name": "Motor speed",
  "min": 0,
  "max": 100,
  "output": {
    "type": "custom"
  }
}
```

The browser displays a numeric input and sends the committed whole-number value. The ESP32 callback receives that number.

### Text input

A text input contains `maxLength`:

```json
{
  "id": "displayText",
  "type": "text",
  "name": "Display text",
  "maxLength": 64,
  "output": {
    "type": "custom"
  }
}
```

The browser displays a single-line text input and sends the value when the user commits it with Enter or leaves the input. Text controls use a custom callback because standard Firmata has no generic application-text output.

## Output mappings

The initial system supports four output types.

| Output type | Firmata behavior | Appropriate controls |
| --- | --- | --- |
| `digital` | Configure the pin as digital output and write `LOW` or `HIGH`. | Toggle or momentary button. |
| `pwm` | Configure the pin for PWM and write the numeric value. | Slider or number input. |
| `servo` | Configure the pin for servo output and write the numeric angle. | Slider or number input. |
| `custom` | Send the control ID and value using the rover-peripheral `CONTROL` operation. | Any control type. |

Standard output mappings include a numeric `pin`. Custom outputs do not need a handler name in the description because the control's own `id` is the callback lookup key.

This keeps the declarations small:

```json
{"type":"servo","pin":14}
```

```json
{"type":"custom"}
```

## Replacing built-in rover GPIO controls

The camera-tilt servo, headlight, and laser already have established server commands, state handling, keybindings, gamepad mappings, and desktop/mobile UI. An ESP32 must be able to provide the physical outputs for those features without recreating them as generic peripheral controls.

The peripheral description therefore has two separate sections:

- `roverControls` declares standardized implementations of existing rover hardware roles.
- `controls` declares new generic controls that appear in the peripheral's vertical UI column.

A control declared under `roverControls` does not also appear in `controls`. It powers the existing first-class rover control instead of creating a duplicate UI element.

### Standardized rover roles

The initial standardized roles are:

| Role | Existing behavior retained | Firmata output |
| --- | --- | --- |
| `cameraServo` | Camera tilt slider, nudging, logical angle range, home angle, inversion, pulse limits, raw-pulse policy, and movement rate limiting. | Servo configuration and servo writes. |
| `headlight` | Existing toggle commands, displayed state, keybinding, gamepad mapping, and `headlight.state` events. | Digital writes. |
| `laser` | Existing toggle commands, displayed state, keybinding, gamepad mapping, room-light policy, and `laser.state` events. | Digital writes. |

An ESP32 that supplies all three roles describes:

```json
{
  "name": "Rover GPIO",
  "roverControls": {
    "cameraServo": {
      "pin": 14,
      "minimumAngleDegrees": -15,
      "maximumAngleDegrees": 30,
      "homeAngleDegrees": 0,
      "nudgeDegrees": 2,
      "minimumPulseMicroseconds": 900,
      "maximumPulseMicroseconds": 2100,
      "allowRawPulse": false,
      "inverted": false
    },
    "headlight": {
      "pin": 18,
      "activeLow": false,
      "initiallyOn": false
    },
    "laser": {
      "pin": 16,
      "activeLow": false,
      "initiallyOn": false
    }
  },
  "controls": []
}
```

The ESP32 description owns the calibration for hardware attached to that ESP32. Rover YAML does not repeat the ESP32 pin numbers or servo calibration.

### Optional backend-selection rule

`roverd` resolves each built-in role once during startup:

1. If that native Pi GPIO feature is enabled in rover YAML, use the native Pi implementation.
2. Otherwise, if exactly one discovered ESP32 declares the role, use its Firmata implementation.
3. Otherwise, leave the built-in feature disabled.

Native configuration deliberately wins. A Pi rover can attach an ESP32 for unrelated generic controls without unexpectedly moving its existing camera servo, headlight, or laser to the ESP32. To deliberately use the ESP32 for one of those features, disable only that native feature in rover YAML.

Any rover configuration that should use the ESP32 for these roles keeps the corresponding native GPIO features disabled:

```yaml
cameraServo:
  enabled: false

headlight:
  enabled: false

laser:
  enabled: false
```

An attached ESP32 can then fill any or all of those roles automatically at the next `roverd` start. This works identically on Raspberry Pi and laptop rover hosts; no USB path or backend name is added to YAML.

Conflict behavior is fixed and simple:

- Native feature enabled and ESP32 declares the same role: use native and log that the ESP32 role was ignored.
- Native feature disabled and one ESP32 declares the role: use that ESP32.
- Native feature disabled and no ESP32 declares the role: disable the feature.
- Native feature disabled and multiple ESP32s declare the same role: fail startup with a duplicate-role error rather than choosing by USB enumeration order.

### Shared controller interfaces

The current `WSClient` directly owns concrete `*CameraServo` and `*GPIOToggle` values. Supporting either physical backend cleanly requires it to depend on the behavior it uses instead of a platform-specific concrete type.

The intended interfaces are:

```go
type CameraServoController interface {
	SetAngle(angle float64) error
	Nudge(delta float64) error
	SetPulseWidth(micros int) error
	CurrentAngle() float64
	Configuration() CameraServoConfig
	Close()
}

type ToggleController interface {
	HandleAction(action string) error
	On() bool
	Configuration() GPIOToggleConfig
	Close()
}
```

Implementations are:

```text
CameraServoController
├── Pi camera-servo backend
└── Firmata camera-servo backend

ToggleController
├── Pi GPIO-toggle backend
└── Firmata digital-toggle backend
```

`WSClient` continues dispatching the existing `servo`, `headlight`, and `laser` commands without branching on the selected backend. This keeps all server and browser contracts independent of the physical hardware.

### Effective hello metadata

The current hello is built from `c.cfg.CameraServo`, `c.cfg.Headlight`, and `c.cfg.Laser`. That cannot remain the source of truth because an ESP32 role may enable a feature whose native YAML entry is disabled.

After startup resolution, the selected controller supplies the effective public configuration. `sendHello()` advertises that effective configuration:

```json
{
  "cameraServo": {
    "enabled": true,
    "minAngle": -15,
    "maxAngle": 30,
    "homeAngle": 0,
    "nudgeDegrees": 2,
    "allowRawPulse": false,
    "invert": false
  },
  "headlight": {
    "enabled": true,
    "initialOn": false,
    "activeLow": false
  },
  "laser": {
    "enabled": true,
    "initialOn": false,
    "activeLow": false
  }
}
```

The physical pin is not needed by the server or browser. Existing UI availability continues to depend on the established `cameraServo.enabled`, `headlight.enabled`, and `laser.enabled` fields.

### Camera-servo behavior

The present Pi camera-servo implementation combines logical behavior with the Pi PWM write. It should be separated so both backends retain identical control feel:

```text
Shared camera-servo controller
├── angle limits
├── home angle
├── nudge behavior
├── inversion
├── pulse calibration
├── raw-pulse policy
├── movement rate limiting
└── physical output
    ├── Pi PWM writer
    └── Firmata servo writer
```

For Firmata, `roverd` configures the servo pin with the ESP32-declared pulse limits and maps the logical rover angle into the servo output range. A raw pulse command, when enabled, is clamped to the declared pulse range and converted to the corresponding Firmata servo position. The existing server command shape does not change.

### Headlight and laser behavior

Logical toggle state remains in `roverd`, just as it does now. The shared controller resolves `toggle`, `on`, and `off`, then asks its backend to write the resulting boolean.

The Firmata toggle backend converts the logical value using `activeLow` before sending the digital write. After a successful write, the existing code emits `headlight.state` or `laser.state`. Server-owned laser restrictions therefore remain in the existing command path and cannot be bypassed by selecting the Firmata backend.

## ESP32 authoring API

Peripheral programs include `RoverPeripheral.h` and define
`configureRoverPeripheral()`. The library provides serial setup, Firmata setup,
`setup()`, and `loop()`.

Configurations use structs. Programs assign one named field per line and then
register the completed configuration. This avoids positional lists for settings
such as angles, pulse widths, polarity, and ranges.

### Complete firmware

This program defines the standard camera tilt, headlight, and laser roles. It
also defines slider, button, number, and text accessory controls.

```cpp
#include <RoverPeripheral.h>

namespace {
constexpr uint8_t specialActionPin = 21;

int repeatCount = 1;
String displayMessage;

void runSpecialAction(bool pressed) {
  digitalWrite(specialActionPin, pressed ? HIGH : LOW);
}

void setRepeatCount(int value) {
  repeatCount = value;
}

void setDisplayMessage(const String& value) {
  displayMessage = value;
}
}  // namespace

void configureRoverPeripheral(RoverPeripheral& peripheral) {
  peripheral.name("Example rover peripheral");

  RoverCameraServoConfig cameraServo;
  cameraServo.pin = 14;
  cameraServo.minimumAngleDegrees = -15;
  cameraServo.maximumAngleDegrees = 30;
  cameraServo.homeAngleDegrees = 0;
  cameraServo.nudgeDegrees = 2;
  cameraServo.minimumPulseMicroseconds = 900;
  cameraServo.maximumPulseMicroseconds = 2100;
  cameraServo.allowRawPulse = false;
  cameraServo.inverted = false;
  peripheral.addCameraServo(cameraServo);

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;
  peripheral.addHeadlight(headlight);

  RoverDigitalOutputConfig laser;
  laser.pin = 16;
  laser.polarity = OutputPolarity::ActiveHigh;
  laser.initiallyOn = false;
  peripheral.addLaser(laser);

  pinMode(specialActionPin, OUTPUT);
  digitalWrite(specialActionPin, LOW);

  SliderControlConfig brightness;
  brightness.name = "Light brightness";
  brightness.minimum = 0;
  brightness.maximum = 255;

  PwmOutput brightnessOutput;
  brightnessOutput.pin = 17;

  peripheral.addSlider(brightness, brightnessOutput);

  ButtonControlConfig action;
  action.name = "Special action";
  action.mode = ButtonMode::Momentary;

  peripheral.addButton(action, runSpecialAction);

  NumberControlConfig repeats;
  repeats.name = "Repeat count";
  repeats.minimum = 1;
  repeats.maximum = 20;

  peripheral.addNumber(repeats, setRepeatCount);

  TextControlConfig message;
  message.name = "Display message";
  message.maximumLength = 64;

  peripheral.addText(message, setDisplayMessage);
}
```

Controls appear in registration order. Each accessory control name must be
non-empty and unique within its peripheral. The name is also its wire
identifier.

### Built-in rover roles

The standard roles use these configuration types:

```cpp
RoverCameraServoConfig
RoverDigitalOutputConfig
```

They are registered with:

```cpp
peripheral.addCameraServo(cameraServo);
peripheral.addHeadlight(headlight);
peripheral.addLaser(laser);
```

Camera servo programs set the pin, logical angle range, home angle, nudge size,
pulse range, raw-pulse policy, and inversion in
`RoverCameraServoConfig`. Headlight and laser programs set the pin, polarity,
and initial state in `RoverDigitalOutputConfig`.

These roles keep the existing camera tilt, headlight, and laser HUD controls.
They do not add entries to the accessory list.

### Standard accessory outputs

A servo slider combines `SliderControlConfig` with `ServoOutput`:

```cpp
SliderControlConfig position;
position.name = "Arm position";
position.minimum = 0;
position.maximum = 180;

ServoOutput servo;
servo.pin = 13;

peripheral.addSlider(position, servo);
```

A PWM slider combines `SliderControlConfig` with `PwmOutput`:

```cpp
SliderControlConfig brightness;
brightness.name = "Light brightness";
brightness.minimum = 0;
brightness.maximum = 255;

PwmOutput light;
light.pin = 17;

peripheral.addSlider(brightness, light);
```

A digital button combines `ButtonControlConfig` with `DigitalOutput`:

```cpp
ButtonControlConfig workLight;
workLight.name = "Work light";
workLight.mode = ButtonMode::Toggle;

DigitalOutput light;
light.pin = 21;
light.polarity = OutputPolarity::ActiveHigh;

peripheral.addButton(workLight, light);
```

### Custom accessory functions

A custom slider passes its value to a callback:

```cpp
SliderControlConfig speed;
speed.name = "Motor speed";
speed.minimum = 0;
speed.maximum = 100;

peripheral.addSlider(speed, setMotorSpeed);
```

A custom button passes its logical state to a bool callback:

```cpp
ButtonControlConfig motor;
motor.name = "Motor";
motor.mode = ButtonMode::Momentary;

peripheral.addButton(motor, setMotorRunning);
```

Momentary bool callbacks receive `true` on press and `false` on release. A
zero-argument callback may be registered for a momentary action that runs only
on press.

Number and text inputs use their corresponding configuration structs:

```cpp
NumberControlConfig repeats;
repeats.name = "Repeat count";
repeats.minimum = 1;
repeats.maximum = 20;
peripheral.addNumber(repeats, setRepeatCount);

TextControlConfig message;
message.name = "Display message";
message.maximumLength = 64;
peripheral.addText(message, setDisplayMessage);
```

A program may define `updateRoverPeripheral()` for recurring work:

```cpp
void updateRoverPeripheral() {
  // Update application state.
}
```

Callbacks and recurring work must not block Firmata processing. Programs must
not write debug output to `Serial` because Firmata uses that stream.

### Library runtime

The library runtime performs these steps:

1. opens `Serial` at 115200 baud;
2. calls `configureRoverPeripheral()`;
3. sets the serial timeout to zero;
4. initializes Firmata and the rover-peripheral feature;
5. applies initial output states; and
6. processes Firmata messages and optional recurring work.

The zero timeout prevents ConfigurableFirmata from waiting for its receive
buffer to fill before processing a short command.

### PlatformIO package

The package source and reference project are:

```text
esp32/
├── libraries/
│   └── RoverPeripheralFirmata/
│       ├── library.json
│       ├── LICENSE
│       ├── README.md
│       ├── examples/
│       └── src/
└── rover-gpio-peripheral/
    ├── platformio.ini
    └── src/main.cpp
```

The published package name is `legop3/RoverPeripheral`. Version `2.0.0`
contains the struct-based public API.

A classic ESP32 PlatformIO project declares:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino

lib_deps =
  legop3/RoverPeripheral @ ^2.0.0
```

A native-USB ESP32-S3 uses `board = esp32-s3-devkitc-1` and:

```ini
build_flags =
  -D ARDUINO_USB_MODE=1
  -D ARDUINO_USB_CDC_ON_BOOT=1
```

The package manifest installs ConfigurableFirmata, ArduinoJson, and ESP32Servo.

Release validation and publication use:

```bash
pio pkg pack esp32/libraries/RoverPeripheralFirmata
pio pkg publish esp32/libraries/RoverPeripheralFirmata --owner legop3
```

Published versions are immutable. Each release uses a new version in
`library.json`.

### Building and probing

Build and upload the repository reference firmware with:

```bash
cd esp32/rover-gpio-peripheral
pio run -e esp32dev
pio run -e esp32dev -t upload --upload-port /dev/ttyUSB0
```

Use `esp32-s3-devkitc-1` and the matching `/dev/ttyACM*` device for a
native-USB ESP32-S3.

```bash
cd pi/roverd
go run ./cmd/peripheral-probe -port /dev/ttyUSB0
```
## Connection lifecycle

### Startup discovery

Peripheral discovery happens exactly once per `roverd` process. The currently implemented startup path runs before `roverd` constructs its existing built-in hardware controllers or connects to the server:

1. Enumerates the serial devices present on Linux.
2. Opens each candidate device found by the startup scan.
3. Waits for a possible board reset and drains stale serial bytes to a quiet read boundary.
4. Starts one Firmata client per opened connection.
5. Performs the normal Firmata firmware and capability queries.
6. Sends the rover-peripheral `DESCRIBE` operation.
7. Decodes and validates each `DESCRIPTION` response.
8. Validates every advertised standard-output pin against Firmata capabilities.
9. Configures generic digital, PWM, and servo pin modes once.
10. Assigns process-local IDs such as `firmata-0` and `firmata-1` in discovery order.
11. Resolves `cameraServo`, `headlight`, and `laser` against the native configuration.
12. Rejects duplicate ESP32 providers only when the corresponding native role is disabled and Firmata selection would otherwise be ambiguous.
13. Constructs the selected native or Firmata controllers and fixed generic inventory.
14. Constructs `WSClient` with those controllers and that inventory.
15. Connects to the server and includes the effective built-in configuration and renderable inventory in the normal rover hello.

The Linux scan checks stable `/dev/serial/by-id/*` names first, then `/dev/ttyUSB*` and `/dev/ttyACM*`. It canonicalizes symlinks so one device is not opened twice under its stable name and kernel name, and it excludes the configured Roomba Open Interface serial device. Each opened candidate receives the same reset wait used by the probe, followed by a read-until-quiet drain so an old partial SysEx cannot contaminate the new handshake.

Firmware and capability queries remain standard Firmata. `RoverPeripheralFirmata::begin()` registers the standard Firmata firmware name `RoverPeripheralFirmata`, so individual sketches do not repeat that discovery detail. A Firmata device with another firmware name is closed and ignored. Once a device identifies itself as rover-peripheral firmware, a malformed capability or description response is a startup error rather than a silently missing configured accessory.

Linux paths such as `/dev/ttyACM0` remain private `roverd` connection details. The browser and server use only the process-local peripheral ID from the hello.

If a serial device responds to Firmata but does not implement the rover-peripheral feature, `roverd` does not publish it or use it as a built-in provider.

### No runtime discovery

`roverd` does not watch for serial-device additions or removals after startup. Changing the physical ESP32 arrangement requires restarting `roverd` or rebooting the rover.

- Connecting an ESP32 after startup has no effect.
- Replacing one ESP32 with another has no effect until restart.
- Reconnecting an unexpectedly disconnected ESP32 does not restore it until restart.
- A restart discards all prior process-local peripheral IDs and rebuilds the entire inventory.

This fixed lifecycle is intentional. It keeps peripheral selection equivalent to the existing boot-time Pi GPIO setup and removes live inventory reconciliation from every layer.

### Unexpected disconnection

If an ESP32 is unplugged or its serial connection fails while `roverd` is running:

1. Its Firmata client marks the connection unavailable.
2. Commands routed to that peripheral or one of its built-in roles return an error.
3. The failed command is logged by the existing rover WebSocket command path.
4. The advertised inventory does not change during that process lifetime.

The first terminal read or write error also produces one concise `tty1`
broadcast through the existing `ConsoleNotifier`:

```text
Rover peripheral "Rover GPIO" (firmata-0) disconnected: <error>. Reconnect it and restart roverd.
```

Normal startup uses the same local-console mechanism to announce every fixed
peripheral, the selected native or ESP32 backend for camera servo, headlight,
and laser, any ignored ESP32 roles, or that no ESP32 was found. Detailed Linux
paths and Firmata handshake diagnostics remain in the systemd journal.

The disconnected device is never replaced automatically by another serial device. This ensures that a command cannot be redirected merely because Linux reused a `/dev/ttyACM*` path.

### Server WebSocket reconnect

The discovered peripherals and resolved controllers belong to the `roverd` process, not an individual server WebSocket. If only the server connection drops, `roverd` reconnects and sends a new hello containing the same startup inventory. It does not rescan USB hardware.

### Rover shutdown

When `roverd` stops, all of its USB connections close. The server already removes the rover when its WebSocket closes, so the rover and all of its peripherals disappear together.

## Rover-to-server messages

The existing rover `hello` includes the fixed startup list and the effective built-in controller configurations:

```json
{
  "type": "hello",
  "name": "rover-name",
  "cameraServo": {
    "enabled": true,
    "minAngle": -15,
    "maxAngle": 30,
    "homeAngle": 0,
    "nudgeDegrees": 2
  },
  "headlight": {
    "enabled": true,
    "initialOn": false
  },
  "laser": {
    "enabled": true,
    "initialOn": false
  },
  "peripherals": [
    {
      "id": "firmata-0",
      "name": "Example peripheral",
      "controls": []
    }
  ]
}
```

No live peripheral or hardware-capability message is required. The server stores the hello metadata in the existing rover record and includes it in the normal roster/session synchronization path.

The browser-facing roster entry therefore contains:

```json
{
  "id": "rover-name",
  "name": "rover-name",
  "peripherals": [
    {
      "id": "firmata-0",
      "name": "Example peripheral",
      "controls": []
    }
  ]
}
```

No global `session.features` flag is necessary. Peripherals are inherently optional: the controls are absent when the rover started without a discovered generic peripheral.

## Browser-to-server control path

The browser sends every peripheral interaction through the existing Socket.IO
`command` event. Peripheral actuation is a rover command, so it does not need a
parallel event or authorization path.

```text
command
```

Payload:

```json
{
  "roverId": "rover-name",
  "type": "peripheral",
  "data": {
    "peripheral": {
      "id": "firmata-0",
      "control": "Servo position",
      "value": 90
    }
  }
}
```

The server performs the same ownership check used by other driver controls:

```js
roverManager.canDrive(roverId, socket)
```

If the socket cannot drive that rover, the event acknowledgement returns an error. If it can, the server passes the generic command through `commandService`:

```json
{
  "type": "peripheral",
  "peripheral": {
    "id": "firmata-0",
    "control": "Servo position",
    "value": 90
  }
}
```

`roverd` resolves the process-local peripheral ID and control description from its fixed startup inventory.

- For `digital`, `pwm`, or `servo`, it sends the corresponding standard Firmata command.
- For `custom`, it sends the rover-peripheral `CONTROL` operation containing the control ID and value.
- If the peripheral connection is unavailable, command dispatch returns an error through the existing rover acknowledgement path and remains unavailable until `roverd` restarts.

The browser does not select a pin, Firmata operation, or custom-function name. It sends only the identifiers from the current session description and the new UI value.

## Standard Firmata command examples

These examples show the logical Firmata operations. The Go Firmata client should build the exact byte messages.

### Servo slider

For servo pin `14` and value `90`:

```text
SET_PIN_MODE pin=14 mode=SERVO
EXTENDED_ANALOG pin=14 value=90
```

Firmata's extended analog message is:

```text
0xF0 0x6F <pin> <value bits 0-6> <value bits 7-13> ... 0xF7
```

`roverd` only needs to set the mode when the connection/control is initialized or when the current pin mode differs. Slider changes then send the value write.

### PWM slider

For PWM pin `18` and value `200`:

```text
SET_PIN_MODE pin=18 mode=PWM
EXTENDED_ANALOG pin=18 value=200
```

`EXTENDED_ANALOG` supports pins beyond the four-bit channel range of Firmata's shorter analog message, so it provides one consistent PWM and servo write path.

### Digital button

For digital pin `19`:

```text
SET_PIN_MODE pin=19 mode=OUTPUT
SET_DIGITAL_PIN_VALUE pin=19 value=1
SET_DIGITAL_PIN_VALUE pin=19 value=0
```

A toggle sends one of the last two writes per activation. A momentary button sends `1` on press and `0` on release.

## Custom callback communication

Suppose `Special action` is pressed. `roverd` creates the JSON payload:

```json
{"control":"Special action","value":true}
```

After 8-to-7-bit encoding, it is placed in:

```text
START_SYSEX
ROVER_PERIPHERAL_FEATURE
CONTROL
encoded payload
END_SYSEX
```

The ESP32 library:

1. Receives the SysEx feature message through Firmata.
2. Decodes the JSON bytes.
3. Reads `control` and `value`.
4. Finds the control registered as `Special action`.
5. Converts the JSON boolean to the registered button callback's `bool` argument.
6. Calls the callback with `true`.

On release the same path carries `false`.

For the reference sketch, the callback drives its output high on press and low
again on release:

```cpp
void runSpecialAction(bool pressed) {
  digitalWrite(specialActionPin, pressed ? HIGH : LOW);
}
```

A hold-style custom function can use both transitions:

```cpp
[](bool pressed) {
  if (pressed) {
    startMotor();
  } else {
    stopMotor();
  }
}
```

## UI behavior

The driver UI finds the assigned rover in `session.roster` and reads its `peripherals` array. It renders:

```text
Peripheral name
    control 1
    control 2
    control 3

Next peripheral name
    control 1
    control 2
```

Each peripheral is one vertical column. Within that column, the browser uses the array order exactly as received. It does not alphabetize or regroup controls.

The generic renderer maps:

- `slider` to a labeled range input.
- `button` with `toggle` mode to a labeled on/off button.
- `button` with `momentary` mode to a press-and-hold button.
- `number` to a labeled numeric input.
- `text` to a labeled single-line text input.

Generic peripheral controls are rover controls, so they follow the new driver's HUD language. They do not belong in either sidebar: the sidebars contain chat, queues, room controls, settings, and other controls that are not direct rover actuation.

The standardized replacements do not create any new UI. `cameraServo`, `headlight`, and `laser` continue to use their current camera-tilt, headlight, and laser HUD controls. Only entries in the generic `controls` arrays appear in a new surface named `Accessories`.

On desktop, `Accessories` is a vertical button centered on the left wall of the video. It uses the existing translucent black HUD treatment and opens a height-limited, vertically scrollable panel toward the right. The panel uses the same compact control renderer as mobile and is independent of the bottom-left horn, headlight, and laser pod.

On mobile, a vertical `Accessories` button sits directly to the right of the vacuum-forward and vacuum-backward buttons. Activating it replaces the complete `AuxColumn` contents with the ordered, vertically scrollable accessory list. A small `Aux` button shares the first compact device heading and returns to the normal vacuum, camera, light, laser, and horn controls without creating a separate rail or overlay border.

Desktop and mobile reuse one placement-independent `RoverAccessoryControls` renderer inside their different containers. Device-specific React components are not created for individual peripherals. The renderer sends actions through `ControlSystemProvider`, `ControlContext`, and the existing command pipeline so assignment gating, input cancellation, and command behavior remain consistent with other rover HUD controls. Both parents and the renderer disappear completely when the assigned rover has no generic controls; no launcher, empty shell, or reserved space remains.

Control values are local UI values in the first implementation. Slider and toggle changes update the displayed value immediately and are then sent to the server. Generic sliders use the same custom pointer-capture approach as mobile camera tilt rather than a browser-native range control, which keeps touch behavior and appearance consistent while driving. Restarting `roverd` recreates controls from the new hello rather than persisting peripheral values in `roverSettings`.

## Permissions

Peripheral permissions have one rule: if a socket can currently drive the rover, it can operate that rover's peripherals.

The server enforces this with the existing `roverManager.canDrive(roverId, socket)` decision. The browser hiding or disabling controls is only presentation; it is not the permission boundary.

No peripheral-specific roles, administrator-only controls, access lists, or permissions in ESP32 configuration are part of this design.

When the driver loses the rover assignment, the UI stops presenting enabled controls and subsequent peripheral commands fail the same server-side drive check.

## Expected repository changes

Implementation should remain concentrated in a few clear areas.

### ESP32 library

The Arduino-compatible `RoverPeripheral` package now contains:

- Ordered control registration.
- Standardized `cameraServo`, `headlight`, and `laser` role registration.
- Generation of the peripheral description.
- Registration of Firmata feature `0x01`.
- `DESCRIBE` response handling.
- `CONTROL` decoding and callback dispatch.
- 8-to-7-bit payload encoding and decoding.
- The public configuration structs and registration methods listed above.
- Arduino `setup()` and `loop()` ownership, including the zero-timeout Firmata
  parser configuration required for immediate short-command handling.

Example ESP32 sketches import only `RoverPeripheral.h` rather than exposing or
hand-writing any Firmata setup or SysEx parsing.

The package source lives in `esp32/libraries/RoverPeripheralFirmata`, with the
complete `esp32/rover-gpio-peripheral` PlatformIO project serving as the
repository reference firmware. The package manifest, README, and examples are
self-contained so the same directory can be published directly to the
PlatformIO Registry as `legop3/RoverPeripheral`.

### `pi/roverd`

`PeripheralManager` is responsible for:

- One-time Linux USB serial discovery during startup on either rover host type.
- One Firmata client per connected peripheral.
- Firmata handshake and capability queries.
- Rover-peripheral description queries.
- The fixed process-local peripheral list.
- Startup resolution of native Pi and Firmata built-in-control backends.
- Standard Firmata output dispatch.
- Custom `CONTROL` dispatch.
- Rejecting commands for disconnected peripheral IDs.

The manager validates every advertised standard-output pin against the device's Firmata capability response and configures each generic pin mode once during startup. Runtime servo and PWM changes therefore send only value writes; they do not repeatedly detach and reconfigure the hardware output. Generic digital controls start logically off, including the corresponding high electrical level for active-low declarations.

Only renderable control metadata leaves `roverd`. Firmata pin numbers, output mappings, Linux paths, live clients, capabilities, and built-in-role declarations stay in the manager's private fixed inventory. The rover hello contains process-local peripheral IDs, names, and ordered generic controls.

The manager should remain independent of the existing Roomba Open Interface serial adapter. A peripheral serial connection is not the Roomba base serial connection and must not be routed through `SerialAdapter`.

The transport foundation is a focused Firmata parser/client in `pi/roverd/firmata.go`. It operates on `io.ReadWriteCloser`, which keeps byte-stream behavior testable without hardware and lets discovery pass either `/dev/ttyUSB*` or `/dev/ttyACM*` ports into the same client. `pi/roverd/cmd/peripheral-probe` remains the direct hardware diagnostic entry point, while `PeripheralManager` now connects the same client to automatic daemon startup discovery.

`WSClient` now depends on shared camera-servo and toggle controller interfaces rather than platform-selected concrete types. The startup resolver uses the same native-first rule in the ARM Pi and amd64 laptop binaries. Firmata camera movement retains the established limits, home position, nudging, inversion, pulse calibration, raw-pulse policy, and movement-rate behavior; Firmata toggles retain logical state and polarity conversion.

### Server

Extend the existing rover connection and roster path to:

- Accept `peripherals` in rover hello metadata.
- Include peripherals in `roverManager.getRoster()`.
- Continue exposing effective `cameraServo`, `headlight`, and `laser` metadata through their existing roster fields regardless of physical backend.
- Route generic controls through the existing Socket.IO `command` handler.
- Reuse `roverManager.canDrive()` for authorization.
- Forward the command through `commandService` so rover acknowledgements remain consistent with other controls.

### Web UI

Add one generic peripheral control renderer that:

- Selects the assigned rover and its peripherals from session state.
- Preserves peripheral and control array order.
- Renders only the four agreed control types.
- Sends every interaction through the existing `command` event with type `peripheral`.
- Supports momentary press and release for pointer, touch, and keyboard activation.
- Mounts in the desktop left-wall expansion and as a replacement view inside mobile `AuxColumn`.
- Uses the shared control context and command pipeline rather than emitting directly from layout code.
- Disappears completely when the assigned rover has no peripherals.

## Implementation sequence

The implemented vertical path is:

1. The public ESP32 package declares built-in roles and ordered accessory controls.
2. Its private Firmata implementation advertises the generated description.
3. `roverd` discovers all startup peripherals and resolves hardware backends.
4. Rover hello metadata carries the fixed renderable inventory to the server.
5. The server preserves that inventory in the roster and applies normal driver authorization.
6. The shared web renderer presents the four control types on desktop and mobile.
7. Commands return through the existing pipeline to standard Firmata outputs or custom callbacks.
8. The package README and examples give external authors the same concise API used by the repository firmware.

The protocol and session shapes are arrays from the beginning, so supporting multiple devices does not require changing the external contracts after the first-device vertical slice.

## Verification scenarios

The completed system should be verified with a real ESP32 and rover Linux computer rather than only mocked serial data.

### Discovery

- Start `roverd` without an ESP32 and confirm no peripheral or ESP32-provided built-in controls appear.
- Stop `roverd`, connect the ESP32, and start it again.
- Confirm the Firmata handshake completes.
- Confirm the peripheral description reaches the assigned driver's session.
- Confirm controls appear in registration order.
- Connect an ESP32 after startup and confirm it is intentionally ignored until restart.

### Standard controls

- Move the reference brightness slider and confirm pin 17 receives PWM values across the declared range.
- Register a `SliderControlConfig` with a `ServoOutput` and confirm its selected pin receives servo values across the declared range.
- Confirm neither standard control invokes the custom callback path.

### Custom controls

- Press the momentary button and confirm the ESP32 callback receives `true` once.
- Release it and confirm the callback receives `false` once.
- Submit number and text values and confirm their typed callbacks receive the advertised values.
- Cancel a held pointer or leave the control layout and confirm a release is sent.
- Confirm arbitrary non-blocking ESP32 behavior can continue from `updateRoverPeripheral()` after the callback changes its state.

### Permissions

- Confirm the current driver can use all connected peripheral controls.
- Confirm a spectator or a user assigned to another rover cannot operate them.
- Change drivers and confirm permission follows the rover assignment immediately.

### Built-in GPIO replacement

- Start either rover host type with native camera servo, headlight, and laser disabled and an ESP32 declaring all three roles.
- Confirm the normal camera tilt, headlight, and laser UI appears without generic duplicates.
- Confirm camera angle limits, home position, nudge amount, inversion, pulse calibration, and rate limiting match the declared ESP32 configuration.
- Confirm headlight and laser toggle state events remain identical to the native Pi path.
- Confirm existing laser restrictions still apply with the Firmata backend.
- Enable a native role and declare the same ESP32 role; confirm native wins and the ignored role is logged.
- Disable native and declare the same role from two ESP32s; confirm startup fails with a clear duplicate-role error.
- Confirm a Pi rover can use native built-in controls and generic ESP32 controls simultaneously.
- Repeat ESP32 role selection on both the ARM Pi binary and amd64 laptop binary and confirm their commands and advertised configurations match.

### Fixed-device lifecycle

- Unplug an ESP32 after startup and confirm its commands fail cleanly while its advertised controls remain fixed.
- Reconnect it without restarting and confirm it is not silently rebound.
- Restart `roverd` and confirm the reconnected peripheral becomes available again.
- Swap the ESP32 while `roverd` is stopped and confirm the new startup description replaces the old one completely.
- Restart only the server connection and confirm `roverd` resends the same startup inventory without rescanning USB.

### Multiple peripherals

- Connect two peripherals and confirm both appear separately.
- Confirm each peripheral preserves its own control order.
- Operate controls with identical control IDs on both devices and confirm process-local peripheral IDs route them to the correct startup connection.
- Unplug one and confirm commands to it fail without affecting commands to the other startup connection.

## Final design summary

The system uses Firmata exactly where Firmata is useful:

- Device discovery and capability communication occur on a Firmata connection.
- Digital, PWM, and servo controls use standard Firmata commands.
- One Firmata user feature advertises the UI description and invokes arbitrary ESP32 callbacks.
- The ESP32 program registers controls in UI order through a small helper library.
- An ESP32 can optionally provide the existing camera-servo, headlight, and laser roles when their native Pi GPIO configurations are disabled.
- `roverd` discovers peripherals and resolves native or Firmata hardware backends once during startup.
- The server applies the existing driver permission rule.
- The web UI renders four generic control types in a vertical column.

There is no device-specific rover configuration, live hot-plug behavior, separate serial transport, numbered application-action registry, or requirement for the server or browser to understand the attached hardware. Changing ESP32 hardware requires restarting `roverd` or rebooting the rover.

## Firmata references

- [Firmata core protocol](https://github.com/firmata/protocol/blob/master/protocol.md) defines SysEx framing, firmware and capability queries, pin modes, digital writes, extended analog writes, and the requirement that SysEx payload bytes are 7-bit values.
- [Firmata feature registry](https://github.com/firmata/protocol/blob/master/feature-registry.md) reserves feature IDs `0x01` through `0x0F` for user-defined features.
- [Firmata servo feature](https://github.com/firmata/protocol/blob/master/servos.md) documents servo configuration and use with Firmata analog output messages.
- [ConfigurableFirmata](https://github.com/firmata/ConfigurableFirmata) is the reference modular Firmata firmware whose feature structure should be evaluated when implementing the ESP32 helper library.
