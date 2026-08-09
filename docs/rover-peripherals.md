# Boot-discovered rover peripherals

This document defines the planned system for attaching self-describing ESP32 peripherals to a rover over USB. A peripheral advertises a small ordered set of controls, the web UI renders those controls automatically, and the current driver can use them without adding device-specific configuration to the rover or server.

The design deliberately stays small:

- Firmata is the only serial protocol.
- Standard Firmata commands operate ordinary digital, PWM, and servo outputs.
- One Firmata user feature advertises controls and invokes custom ESP32 callbacks.
- A peripheral can expose sliders, buttons, number inputs, and text inputs.
- Controls appear in one vertical column in the order registered by the ESP32 program.
- Anyone who can currently drive the rover can use its peripheral controls.
- Peripherals are discovered once when `roverd` starts; changing one requires restarting the rover.
- There is no peripheral configuration in the rover configuration file.
- There is no separate rover-peripheral protocol version.

This is a design document. The names of proposed Go, JavaScript, and Arduino APIs describe the intended implementation and do not refer to code that already exists.

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
- Update state used by non-blocking work in `loop()`.

Application authors use string IDs such as `specialAction` or `animationSpeed`. They do not assign numeric action IDs. Firmata necessarily uses a numeric SysEx feature byte internally, but that is an implementation detail hidden by the peripheral library.

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

Peripheral authors never perform this encoding themselves. It belongs in the ESP32 `RoverPeripheralFirmata` library and the Go Firmata client used by `roverd`.

## Peripheral description

The ESP32 library builds this description from the controls registered during `setup()`. The order of the `controls` array is the registration order and is also the UI order.

An example description is:

```json
{
  "name": "Example peripheral",
  "controls": [
    {
      "id": "servoPosition",
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
      "id": "lightBrightness",
      "type": "slider",
      "name": "Light brightness",
      "min": 0,
      "max": 255,
      "output": {
        "type": "pwm",
        "pin": 18
      }
    },
    {
      "id": "specialAction",
      "type": "button",
      "name": "Run special action",
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
  "name": "Laptop rover GPIO",
  "roverControls": {
    "cameraServo": {
      "output": {
        "type": "servo",
        "pin": 14
      },
      "minAngle": -15,
      "maxAngle": 30,
      "homeAngle": 0,
      "nudgeDegrees": 2,
      "minPulseUs": 900,
      "maxPulseUs": 2100,
      "allowRawPulse": false,
      "invert": false
    },
    "headlight": {
      "output": {
        "type": "digital",
        "pin": 18
      },
      "initialOn": false,
      "activeLow": false
    },
    "laser": {
      "output": {
        "type": "digital",
        "pin": 19
      },
      "initialOn": false,
      "activeLow": false
    }
  },
  "controls": []
}
```

The ESP32 description owns the calibration for hardware attached to that ESP32. Laptop rover YAML does not repeat the ESP32 pin numbers or servo calibration.

### Optional backend-selection rule

`roverd` resolves each built-in role once during startup:

1. If that native Pi GPIO feature is enabled in rover YAML, use the native Pi implementation.
2. Otherwise, if exactly one discovered ESP32 declares the role, use its Firmata implementation.
3. Otherwise, leave the built-in feature disabled.

Native configuration deliberately wins. A Pi rover can attach an ESP32 for unrelated generic controls without unexpectedly moving its existing camera servo, headlight, or laser to the ESP32. To deliberately use the ESP32 for one of those features, disable only that native feature in rover YAML.

The normal laptop configuration keeps the unavailable native GPIO features disabled:

```yaml
cameraServo:
  enabled: false

headlight:
  enabled: false

laser:
  enabled: false
```

An attached ESP32 can then fill any or all of those roles automatically at the next `roverd` start. No USB path or backend name is added to YAML.

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

Peripheral authors should not write JSON, construct SysEx messages, or manually dispatch control IDs. The proposed `RoverPeripheralFirmata` Arduino library owns those tasks.

A long positional call such as `addRoverCameraServo(14, -15, 30, 0, 2, 900, 2100, false, false)` is deliberately not part of the API. Several adjacent numbers and booleans are too difficult to understand or review without repeatedly consulting the function signature.

The public API uses named configuration structs. Field names include units where a bare number would otherwise be ambiguous, and enums replace booleans whose meaning would be unclear at the call site.

### Proposed configuration types

The core public types are:

```cpp
enum class OutputPolarity {
  ActiveHigh,
  ActiveLow
};

enum class ButtonMode {
  Toggle,
  Momentary
};

struct FirmataServoOutput {
  uint8_t pin;
};

struct FirmataPwmOutput {
  uint8_t pin;
};

struct FirmataDigitalOutput {
  uint8_t pin;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
};

struct RoverCameraServoConfig {
  uint8_t pin;

  float minimumAngleDegrees;
  float maximumAngleDegrees;
  float homeAngleDegrees = 0;
  float nudgeDegrees = 2;

  uint16_t minimumPulseMicroseconds = 900;
  uint16_t maximumPulseMicroseconds = 2100;

  bool allowRawPulse = false;
  bool inverted = false;
};

struct RoverDigitalOutputConfig {
  uint8_t pin;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
  bool initiallyOn = false;
};

struct SliderControlConfig {
  String id;
  String name;
  int minimum;
  int maximum;
};

struct ButtonControlConfig {
  String id;
  String name;
  ButtonMode mode;
};

struct NumberControlConfig {
  String id;
  String name;
  int minimum;
  int maximum;
};

struct TextControlConfig {
  String id;
  String name;
  size_t maximumLength;
};
```

Defaults cover values that are commonly shared, but required hardware and display values remain explicit. The implementation must validate the completed struct when it is registered rather than assuming that every default-constructed object is usable.

The API uses ordinary field assignments instead of C++ designated initializers. This keeps example sketches compatible with ESP32 Arduino toolchains that are not configured for C++20.

### Generic-control registration

A complete sketch for one servo slider, one light-brightness slider, and one custom momentary button is:

```cpp
#include <Arduino.h>
#include <ConfigurableFirmata.h>
#include <RoverPeripheralFirmata.h>

/*
 * Controls are advertised in the order they are added to this object. The
 * browser preserves that order when it renders the peripheral's column.
 */
RoverPeripheralFirmata peripheral("Example peripheral");

/*
 * This is ordinary application code rather than Firmata plumbing. A real
 * peripheral can replace it with any device-specific sequence or library call.
 */
void runSpecialAction() {
  // Start or schedule the peripheral's custom behavior here.
}

void setup() {
  Firmata.begin(115200);

  /*
   * roverd handles this control with standard Firmata SERVO commands. The
   * ESP32 application does not need a callback for each slider update.
   */
  SliderControlConfig servoPosition;
  servoPosition.id = "servoPosition";
  servoPosition.name = "Servo position";
  servoPosition.minimum = 0;
  servoPosition.maximum = 180;

  FirmataServoOutput servoOutput;
  servoOutput.pin = 14;

  peripheral.addServoSlider(servoPosition, servoOutput);

  /*
   * roverd handles this control with standard Firmata PWM commands. The range
   * is included in the generated description and displayed by the web UI.
   */
  SliderControlConfig lightBrightness;
  lightBrightness.id = "lightBrightness";
  lightBrightness.name = "Light brightness";
  lightBrightness.minimum = 0;
  lightBrightness.maximum = 255;

  FirmataPwmOutput lightOutput;
  lightOutput.pin = 18;

  peripheral.addPwmSlider(lightBrightness, lightOutput);

  /*
   * Custom controls are delivered through the rover-peripheral Firmata feature.
   * The library finds this registration by control ID and invokes the callback
   * with true on press and false on release.
   */
  ButtonControlConfig specialAction;
  specialAction.id = "specialAction";
  specialAction.name = "Run special action";
  specialAction.mode = ButtonMode::Momentary;

  peripheral.addButton(
    specialAction,
    [](bool pressed) {
      if (pressed) {
        runSpecialAction();
      }
    }
  );

  // Register the extension with Firmata and finalize the control description.
  peripheral.begin();
}

void loop() {
  // Standard Firmata messages and rover-peripheral SysEx messages share this parser.
  while (Firmata.available()) {
    Firmata.processInput();
  }

  // Let the peripheral library perform any deferred send or callback work.
  peripheral.update();
}
```

The intended generic registration methods are:

```cpp
addServoSlider(const SliderControlConfig&, const FirmataServoOutput&)
addPwmSlider(const SliderControlConfig&, const FirmataPwmOutput&)
addDigitalButton(const ButtonControlConfig&, const FirmataDigitalOutput&)

addSlider(const SliderControlConfig&, SliderCallback)
addButton(const ButtonControlConfig&, ButtonCallback)
addNumber(const NumberControlConfig&, NumberCallback)
addText(const TextControlConfig&, TextCallback)
```

These helpers still produce only the four agreed UI types. The overload or method name distinguishes a standard Firmata output from a custom callback; it does not create an additional UI type.

The standardized built-in replacements use separate methods because they do not create generic UI controls:

```cpp
addRoverCameraServo(const RoverCameraServoConfig&)
addRoverHeadlight(const RoverDigitalOutputConfig&)
addRoverLaser(const RoverDigitalOutputConfig&)
```

A laptop GPIO peripheral can combine built-in replacements and additional controls:

```cpp
#include <Arduino.h>
#include <ConfigurableFirmata.h>
#include <RoverPeripheralFirmata.h>

RoverPeripheralFirmata peripheral("Laptop rover GPIO");

void setup() {
  Firmata.begin(115200);

  /*
   * These declarations satisfy existing rover roles. They retain the normal
   * camera, headlight, and laser UI instead of entering the generic column.
   */
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

  peripheral.addRoverCameraServo(cameraServo);

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;

  peripheral.addRoverHeadlight(headlight);

  RoverDigitalOutputConfig laser;
  laser.pin = 19;
  laser.polarity = OutputPolarity::ActiveHigh;
  laser.initiallyOn = false;

  peripheral.addRoverLaser(laser);

  /*
   * This is an additional feature, so it appears below the peripheral heading
   * in the ordered generic-control column.
   */
  SliderControlConfig underglowBrightness;
  underglowBrightness.id = "underglowBrightness";
  underglowBrightness.name = "Underglow brightness";
  underglowBrightness.minimum = 0;
  underglowBrightness.maximum = 255;

  peripheral.addSlider(
    underglowBrightness,
    [](int brightness) {
      setUnderglowBrightness(brightness);
    }
  );

  peripheral.begin();
}

void loop() {
  while (Firmata.available()) {
    Firmata.processInput();
  }
  peripheral.update();
}
```

## Connection lifecycle

### Startup discovery

Peripheral discovery happens exactly once per `roverd` process. Before constructing the built-in hardware controllers or connecting to the server, `roverd`:

1. Enumerates the serial devices present on Linux.
2. Opens each candidate device found by the startup scan.
3. Starts one Firmata client per opened connection.
4. Performs the normal Firmata firmware and capability queries.
5. Sends the rover-peripheral `DESCRIBE` operation.
6. Decodes and parses each `DESCRIPTION` response.
7. Assigns process-local IDs such as `firmata-0` and `firmata-1`.
8. Resolves the optional `cameraServo`, `headlight`, and `laser` roles.
9. Builds the fixed generic peripheral list.
10. Constructs `WSClient` with the resolved built-in controllers and peripherals.
11. Connects to the server and sends the normal rover hello.

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
3. `roverd` logs that the peripheral requires reconnection followed by a restart.
4. The advertised roster and visible controls do not change during that process lifetime.

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

The browser sends one generic Socket.IO event for every peripheral control:

```text
peripheral:set
```

Payload:

```json
{
  "roverId": "rover-name",
  "peripheralId": "firmata-0",
  "controlId": "servoPosition",
  "value": 90
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
    "control": "servoPosition",
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

Suppose `specialAction` is pressed. `roverd` creates the JSON payload:

```json
{"control":"specialAction","value":true}
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
4. Finds the control registered as `specialAction`.
5. Converts the JSON boolean to the registered button callback's `bool` argument.
6. Calls the callback with `true`.

On release the same path carries `false`.

For the example sketch, only the press runs the one-shot function:

```cpp
[](bool pressed) {
  if (pressed) {
    runSpecialAction();
  }
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

The same generic component is reused by desktop and mobile layouts. Layout wrappers decide where the column appears; device-specific components are not created for individual peripherals.

Control values are local UI values in the first implementation. Slider and toggle changes update the displayed value immediately and are then sent to the server. Restarting `roverd` recreates controls from the new hello rather than persisting peripheral values in `roverSettings`.

## Permissions

Peripheral permissions have one rule: if a socket can currently drive the rover, it can operate that rover's peripherals.

The server enforces this with the existing `roverManager.canDrive(roverId, socket)` decision. The browser hiding or disabling controls is only presentation; it is not the permission boundary.

No peripheral-specific roles, administrator-only controls, access lists, or permissions in ESP32 configuration are part of this design.

When the driver loses the rover assignment, the UI stops presenting enabled controls and subsequent `peripheral:set` requests fail the same server-side drive check.

## Expected repository changes

Implementation should remain concentrated in a few clear areas.

### ESP32 library

Create a small Arduino-compatible `RoverPeripheralFirmata` library containing:

- Ordered control registration.
- Standardized `cameraServo`, `headlight`, and `laser` role registration.
- Generation of the peripheral description.
- Registration of Firmata feature `0x01`.
- `DESCRIBE` response handling.
- `CONTROL` decoding and callback dispatch.
- 8-to-7-bit payload encoding and decoding.
- The standard-output and custom-control helper methods listed above.

Example ESP32 sketches should use this library rather than hand-writing SysEx parsing.

### `pi/roverd`

Add a peripheral manager responsible for:

- One-time Linux USB serial discovery during startup.
- One Firmata client per connected peripheral.
- Firmata handshake and capability queries.
- Rover-peripheral description queries.
- The fixed process-local peripheral list.
- Startup resolution of native Pi and Firmata built-in-control backends.
- Standard Firmata output dispatch.
- Custom `CONTROL` dispatch.
- Rejecting commands for disconnected peripheral IDs.

The manager should remain independent of the existing Roomba Open Interface serial adapter. A peripheral serial connection is not the Roomba base serial connection and must not be routed through `SerialAdapter`.

Refactor camera servo and GPIO toggles so `WSClient` depends on the shared controller interfaces rather than platform-selected concrete types. Preserve the existing logical servo movement and toggle-state behavior above the Pi and Firmata physical writers.

### Server

Extend the existing rover connection and roster path to:

- Accept `peripherals` in rover hello metadata.
- Include peripherals in `roverManager.getRoster()`.
- Continue exposing effective `cameraServo`, `headlight`, and `laser` metadata through their existing roster fields regardless of physical backend.
- Add the generic `peripheral:set` Socket.IO handler.
- Reuse `roverManager.canDrive()` for authorization.
- Forward the command through `commandService` so rover acknowledgements remain consistent with other controls.

### Web UI

Add one generic peripheral control renderer that:

- Selects the assigned rover and its peripherals from session state.
- Preserves peripheral and control array order.
- Renders only the four agreed control types.
- Sends every interaction through the same `peripheral:set` event.
- Supports momentary press and release for pointer, touch, and keyboard activation.
- Fits into the existing desktop and mobile driver control layouts.
- Disappears completely when the assigned rover has no peripherals.

## Implementation sequence

The smallest useful vertical implementation is:

1. Build the ESP32 Firmata feature and the three-control example sketch.
2. Add boot-time one-device USB discovery and Firmata communication to `roverd`.
3. Include the fixed description in the rover hello and server roster.
4. Render the ordered generic controls in the driver UI.
5. Route generic servo and PWM controls through standard Firmata.
6. Route the generic momentary button through the custom callback operation.
7. Add the standardized ESP32 camera-servo, headlight, and laser declarations.
8. Refactor built-in controllers to select native Pi or Firmata backends at startup.
9. Verify that existing tilt, headlight, laser, keybinding, gamepad, state-event, and server-policy behavior is unchanged with both backends.
10. Generalize startup discovery from one connection to multiple simultaneous peripherals.
11. Add the remaining toggle, number, and text registration helpers and UI renderers.

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

- Move the servo slider and confirm pin 14 receives servo values across the declared range.
- Move the brightness slider and confirm pin 18 receives PWM values across the declared range.
- Confirm neither standard control invokes the custom callback path.

### Custom controls

- Press the momentary button and confirm the ESP32 callback receives `true` once.
- Release it and confirm the callback receives `false` once.
- Cancel a held pointer or leave the control layout and confirm a release is sent.
- Confirm arbitrary non-blocking ESP32 behavior can continue from `loop()` after the callback changes its state.

### Permissions

- Confirm the current driver can use all connected peripheral controls.
- Confirm a spectator or a user assigned to another rover cannot operate them.
- Change drivers and confirm permission follows the rover assignment immediately.

### Built-in GPIO replacement

- Start a laptop rover with native camera servo, headlight, and laser disabled and an ESP32 declaring all three roles.
- Confirm the normal camera tilt, headlight, and laser UI appears without generic duplicates.
- Confirm camera angle limits, home position, nudge amount, inversion, pulse calibration, and rate limiting match the declared ESP32 configuration.
- Confirm headlight and laser toggle state events remain identical to the native Pi path.
- Confirm existing laser restrictions still apply with the Firmata backend.
- Enable a native role and declare the same ESP32 role; confirm native wins and the ignored role is logged.
- Disable native and declare the same role from two ESP32s; confirm startup fails with a clear duplicate-role error.
- Confirm a Pi rover can use native built-in controls and generic ESP32 controls simultaneously.

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
