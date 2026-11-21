# Rover/server communication

This describes the current repository implementation. **Only this repository's roverd is officially supported.** This is not a separately versioned public protocol or a compatibility promise. Custom implementations must track repository changes themselves.

## Sources and reading this reference

The Roomba ranges below come from iRobot's [Create 2 Open Interface specification, based on Roomba 600, July 19, 2018](https://cdn.hackaday.io/files/1785657639724960/iRobot_Roomba_600_Open_Interface_Spec.pdf), sensor reference on printed pages 23–32, bit tables on pages 37–39, and firmware notes on page 41. These are hardware ranges, not inferred from the byte width or the UI.

The implementation sources are [sensor decoding](../server/src/helpers/sensorDecoder.js), [state validation](../server/src/helpers/roverState.js), [control messages](../rover/roverd/command.go), [command handling](../rover/roverd/wsclient.go), [peripheral declarations](../rover/roverd/firmata.go), [peripheral values](../rover/roverd/peripheral_manager.go), and [management](../rover/roverd/management.go). Where the current implementation loses information or differs from the hardware specification, that is called out below.

Contents:

- [Connections and identity](#connections-and-identity)
- [Control hello](#control-hello)
- [Operational state](#operational-state)
- [Sensor messages](#sensor-messages)
- [Sensor ranges and meanings](#sensor-ranges-and-meanings)
- [Commands and acknowledgements](#commands-and-acknowledgements)
- [Accessories](#accessories)
- [Management](#management)
- [Media](#media)
- [Minimal custom-client sequence](#minimal-custom-client-sequence)

## Connections and identity

Connect a WebSocket to `/rover` on the server for commands, operational state, and sensors. Send a JSON hello first. `name` is the rover identity and must match its management connection and media paths. A new connection with the same identity becomes the active connection; subsequent messages from the old connection are ignored. The server sends WebSocket ping frames every 15 seconds and disconnects an unresponsive connection. Respond with WebSocket pong frames (normally handled by the WebSocket library).

Send a new hello and complete state after each reconnect. Operational state is cleared on reconnect/disconnect. Sensor timestamps are Unix milliseconds; server arrival time is used for its processing. Management uses a separate WebSocket at `/rover/management`. Media uses RTSP, not either WebSocket.

## Control hello

```json
{"type":"hello","name":"example","description":"Example rover","maxWheelSpeed":300}
```

The core connection needs `type` and `name`. Optional presentation/control metadata used by the application:

| Field | Meaning |
| --- | --- |
| `description`, `color` | Roster presentation. |
| `maxWheelSpeed` | Maximum wheel speed in mm/s. |
| `cameraServo` | Camera role configuration: enabled, angle limits, center and hardware details reported by roverd. |
| `audio`, `horn`, `headlight`, `laser` | Existing role configuration; enabled roles expose their controls. |
| `peripherals` | Generic accessory controls, described below. |
| `private` | Rover private-access and safety settings. |
| `media` | Configured media metadata. |
| `battery` | Rover calibration metadata; never a substitute for reported operational battery state. |

### Hello object fields

The following tables describe the nested objects carried by official roverd. Configuration defaults belong to roverd; a custom client should send the values it actually implements rather than rely on the server to fill in hardware defaults. JSON numbers described as integers must have no fractional part.

| Object | Fields |
| --- | --- |
| `battery` | Integer `full`, `warn`, `urgent`, in mAh. Calibration only. |
| `cameraServo` | Boolean `enabled`, `allowRawPulse`, `invert`; numeric `minAngle`, `maxAngle`, `homeAngle`, `nudgeDegrees` in degrees; integer `minPulseUs`, `maxPulseUs` in microseconds; integer hardware parameters `pin`, `freqHz`, `cycleLen`. The browser uses enabled/angle limits; hardware timing is executed locally. |
| `headlight`, `laser` | Boolean `enabled`, `initialOn`, `activeLow`; integer `gpioPin`; string `gpioChip`. Current state comes from roverState, not initialOn. |
| `audio` | Boolean `ttsEnabled`; strings `inputDevice`, `outputDevice`, `mixerCard`, `defaultEngine`, `defaultVoice`; integer `defaultPitch`, `outputSampleRate` (8000–192000 Hz), `outputChannels` (1–8). Linux device names are local configuration, not sensor values. |
| `horn` | Boolean `enabled`; numeric `volume`, `sineGain`, `sawGain`; integer `sampleRate` in Hz and `channels`; `maxDuration` as a Go duration string, e.g. `"2s"`. |
| `media` | Integer `rtspPort` (1–65535); `video`, `audioCapture`, `audioPlayback` objects, each with boolean `enabled` and string `profile`. Control hello also includes derived string `video.publishUrl`, `audioCapture.publishUrl`, and `audioPlayback.forwardUrl`; these URLs are not editable config fields. |
| `private` | Boolean `enabled` and `safety` object below. |
| `peripherals` | Ordered array described in [Accessories](#accessories). |

`private.safety` contains booleans `speedLimitEnabled`, `hardOvercurrentEnabled`, `hardBumpEnabled`, `cliffEnabled`, `virtualWallEnabled`; integer speeds `speedLimitMaxWheelSpeed`, `bumpBackoffSpeed`, `cliffBackoffSpeed`, `virtualWallBackoffSpeed` in mm/s; and integer durations `overcurrentStopMs`, `bumpBackoffMs`, `cliffBackoffMs`, `virtualWallBackoffMs`, `triggerCooldownMs` in milliseconds. These configure server policy, not autonomous hardware capabilities.

Official roverd sends these objects from its configuration and discovered peripherals. Its management JSON schema documents their complete configuration shapes. A control-only implementation does not need a management connection to report state or sensors.

## Operational state

```json
{"type":"roverState","state":{"drivingMode":true,"dockAssist":false,"docking":false,"docked":false,"battery":{"percent":74,"charging":false,"low":false,"critical":false,"needsCharge":false},"headlightOn":true,"laserOn":null}}
```

Send the whole object on connection and when any field changes. It replaces the previous snapshot. All listed fields are required; each leaf may be `null` for unknown/unavailable. Do not report missing sensors as false or zero.

| Field | Meaning |
| --- | --- |
| `drivingMode` | Hardware is drive-enabled; not a guarantee of server permission or actual wheel movement. |
| `dockAssist` | Rover-controlled manual docking assistance is active. Null means unsupported/unknown. |
| `docking` | Passive hardware mode while not on the dock. Manual assistance is reported separately. |
| `docked` | Physical dock contact. |
| `battery.percent` | Display percentage, 0–100, decimals allowed. |
| `battery.charging` | Charging process, including normal waiting pauses. Instantaneous current remains telemetry. |
| `battery.low`, `battery.critical` | Current warning/critical threshold conditions. |
| `battery.needsCharge` | Charging recovery is still required. It can remain true after the low threshold clears. |
| `headlightOn`, `laserOn` | Current named-role state; null when absent. |

The server uses this state for operational displays, battery locking, docking policies, assignments, and announcements. Raw battery/OI sensor readings cannot override it. Server-owned permissions, locks, assist presentation, and pending commands are separate.

Official roverd computes its displayed percentage using configured urgent/warn/full calibration (0/10/100%). It remembers low-battery recovery across daemon restarts. Recovery clears after five continuous minutes of docked waiting and `(charge-warn)/(full-warn) >= 0.01`, not merely when the display reaches 100%. Missing hardware samples reset the waiting interval and produce null hardware state. An unchanged valid state needs no periodic resend.

Official roverd reports drivingMode true for observed OI safe/full (3/4 in the supported rovers' reported mapping); passive/off are false. Docking is true exactly when the reported mode is passive and Home Base contact is absent. Docked comes from the Home Base bit. Charging is true for OI states 1–4. Low is charge ≤ configured warn, critical is charge ≤ urgent. The calibrated percent is rounded and clamped to 0…100; if calibration is unusable but capacity is positive it falls back to charge/capacity. Hardware state becomes null after 1.5 seconds without samples; headlight/laser state remains independent. A custom rover is responsible for reporting null when its own hardware observations become unavailable.

Malformed roverState is ignored rather than partially merged or acknowledged. All required leaves must exist. The current validator permits extra keys, but extra keys have no defined consumers.

## Sensor messages

Existing Roomba input:

```json
{"type":"sensor","ts":1795000000000,"data":"base64-encoded-complete-OI-stream-frame"}
```

The binary frame is `0x13, N, payload[N], checksum`. Payload is a sequence of packet ID followed by that packet's bytes. The sum of all frame bytes, including checksum, must be 0 modulo 256. Group 100 contains 80 data bytes in packet-number order 7…58, including reserved bytes; it is prefixed once with ID 100, not with every member's ID. Standalone 21 and 34 each have one data byte. Invalid header, short data, unsupported packet ID, or checksum failure discards the reading. Unknown JSON fields similarly discard that JSON sensor message without an ack.

`data` contains the header, byte count, packet payloads and checksum. The decoder accepts packet group 100 plus packets 21 and 34. Packet contents are Roomba-specific; other rovers should use direct JSON:

```json
{"type":"sensor","ts":1795000000000,"sensors":{"cliffLeft":false,"bumpsAndWheelDrops":{"bumpLeft":true,"bumpRight":false},"voltageMv":12400,"wheelSpeedsMmPerSecond":{"left":50,"right":50,"center":50}}}
```

Use one input format per message. Each JSON sensor object is a complete sensor snapshot: omitted fields become unavailable. Fields/nested keys must be known; numeric values must be finite, booleans must be booleans, and null is accepted. Direct JSON wheel speeds are used as reported. Only Roomba binary frames receive server-side encoder-to-speed calculation. No odometer totals are retained.

## Sensor ranges and meanings

Every field below is optional in a direct JSON sensor snapshot. Omit an unavailable field or send null. Nested objects may also omit unavailable members. The server rejects an entire JSON sensor snapshot for unknown keys, wrong types, non-finite numbers, or diagnostic labels longer than 128 characters. **It does not enforce the OI numeric ranges or integer-only values on direct JSON sensor input.** Report meaningful values in the units below anyway.

For binary frames, multi-byte numbers are big-endian. `u8/u16` below mean unsigned 8/16-bit; `s8/s16` mean signed two's-complement. JSON has no byte order. Boolean readings use JSON true/false, never 0/1.

### Scalar fields

The range column is the documented OI range unless explicitly marked as reserved or derived.

| JSON field | Packet | Encoding | Min … max; units | Meaning |
| --- | --- | --- | --- | --- |
| `wall` | 8 | u8 → boolean | false/true | Wall detected. Deprecated OI sensor; light bumper is preferred. |
| `cliffLeft` | 9 | u8 → boolean | false/true | Cliff detected at left sensor; true means cliff, not floor. |
| `cliffFrontLeft` | 10 | u8 → boolean | false/true | Front-left cliff. |
| `cliffFrontRight` | 11 | u8 → boolean | false/true | Front-right cliff. |
| `cliffRight` | 12 | u8 → boolean | false/true | Right cliff. |
| `virtualWall` | 13 | u8 → boolean | false/true | Virtual-wall signal detected. |
| `dirtDetect` | 15 | u8 | 0 … 255 | Dirt signal intensity. |
| `dirtDetectLeft` | 16 | u8 | Reserved; specified value 0 | Historical decoder name for an unused byte; not a second dirt sensor. |
| `infraredCharacterOmni` | 17 | u8 | 0 … 255 | IR code; 0 means no received character. |
| `distanceMm` | 19 | s16 | -32768 … 32767 mm | Accumulated movement since previous read, positive forward, negative reverse. Average wheel distance, not lifetime distance. |
| `angleDeg` | 20 | s16 | -32768 … 32767 degrees | Accumulated turn since previous read; counterclockwise positive. |
| `voltageMv` | 22 | u16 | 0 … 65535 mV | Battery voltage, not volts. |
| `currentMa` | 23 | s16 | -32768 … 32767 mA | Battery current: positive into battery, negative discharge. |
| `batteryTemperatureC` | 24 | s8 | -128 … 127 °C | Battery temperature. |
| `batteryChargeMah` | 25 | u16 | 0 … 65535 mAh | Estimated remaining charge. |
| `batteryCapacityMah` | 26 | u16 | 0 … 65535 mAh | Estimated full capacity. |
| `wallSignal` | 27 | u16 | 0 … 1023 | Raw reflected wall signal. Deprecated; not a distance. |
| `cliffLeftSignal` | 28 | u16 | 0 … 4095 | Raw floor-reflection signal at left sensor. |
| `cliffFrontLeftSignal` | 29 | u16 | 0 … 4095 | Front-left floor-reflection signal. |
| `cliffFrontRightSignal` | 30 | u16 | 0 … 4095 | Front-right floor-reflection signal. |
| `cliffRightSignal` | 31 | u16 | 0 … 4095 | Right floor-reflection signal. |
| `chargingSourcesReserved` | 33 | u16 | Reserved; container 0 … 65535 | No supported hardware meaning; omit for a custom rover. |
| `songNumber` | 36 | u8 | 0 … 15 | OI reported selected song number; distinct from roverd command slot limits. |
| `songPlaying` | 37 | u8 → boolean | false/true | OI song playback active. |
| `streamPacketCount` | 38 | u8 | 0 … 108 | Number reported by OI stream configuration. |
| `requestedVelocity` | 39 | s16 | -500 … 500 mm/s | Last commanded Drive velocity, not measured speed. |
| `requestedRadius` | 40 | s16 | -32768 … 32767 mm | Last commanded Drive radius; special values below. |
| `requestedRightVelocity` | 41 | s16 | -500 … 500 mm/s | Last commanded right wheel speed. |
| `requestedLeftVelocity` | 42 | s16 | -500 … 500 mm/s | Last commanded left wheel speed. |
| `encoderCountsLeft` | 43 | s16 | -32768 … 32767 counts | Cumulative wrapping encoder counter. |
| `encoderCountsRight` | 44 | s16 | -32768 … 32767 counts | Cumulative wrapping encoder counter. |
| `lightBumpLeftSignal` | 46 | u16 | 0 … 4095 | Raw left proximity signal. |
| `lightBumpFrontLeftSignal` | 47 | u16 | 0 … 4095 | Front-left proximity signal. |
| `lightBumpCenterLeftSignal` | 48 | u16 | 0 … 4095 | Center-left proximity signal. |
| `lightBumpCenterRightSignal` | 49 | u16 | 0 … 4095 | Center-right proximity signal. |
| `lightBumpFrontRightSignal` | 50 | u16 | 0 … 4095 | Front-right proximity signal. |
| `lightBumpRightSignal` | 51 | u16 | 0 … 4095 | Right proximity signal. |
| `infraredCharacterLeft` | 52 | u8 | 0 … 255 | Left IR receiver code. |
| `infraredCharacterRight` | 53 | u8 | 0 … 255 | Right IR receiver code. |
| `wheelLeftCurrentMa` | 54 | s16 | -32768 … 32767 mA | Left motor current. |
| `wheelRightCurrentMa` | 55 | s16 | -32768 … 32767 mA | Right motor current. |
| `mainBrushCurrentMa` | 56 | s16 | -32768 … 32767 mA | Main-brush motor current. |
| `sideBrushCurrentMa` | 57 | s16 | -32768 … 32767 mA | Side-brush motor current. |
| `stasis` | 58 | u8 → boolean | OI byte 0 … 3; JSON false/true | **Lossy decoding:** any nonzero byte becomes true; see below. |

`requestedRadius` uses ±1 for turning in place and 32767 or -32768 for straight motion; ordinary commanded turning radii are -2000…2000 mm. Do not interpret those straight-motion sentinels as a measured arc radius.

The cited 2018 specification and this server use signed encoder counts. Other Create 2 OI revisions describe unsigned 0…65535 counters. Both carry the same 16 bits; this server's decoded representation is signed. Wheel-speed calculation accounts for rollover using a 65536-count modulus and converts counts with π × 72 / 508.8 mm per count. Direct JSON encoder fields are only readings; they do not invoke that calculation.

OI stasis byte 0 means no forward progress, 1 means forward progress, and 2 identifies an unreadable/dirty caster sensor. The specification gives a 0…3 range. The current boolean decoder cannot distinguish 1 from 2 or 3. A custom rover should send its forward-progress boolean or null; it cannot express the hardware fault code in this field.

Firmware caveats in the OI specification: distance and requested-radius reporting were fixed in 3.3.0, and angle reporting in 3.4.1. Do not assume older firmware reports those values correctly.

### Bitfields and nested objects

Each named member below becomes a JSON boolean. Reserved bits do not acquire new JSON fields.

| Object | Packet / raw range | Members and original bit positions |
| --- | --- | --- |
| `bumpsAndWheelDrops` | 7, u8, 0…15 | `bumpRight` bit 0; `bumpLeft` bit 1; `wheelDropRight` bit 2; `wheelDropLeft` bit 3. True means pressed/dropped. |
| `wheelOvercurrents` | 14, u8, documented 0…31 | `sideBrush` bit 0; bit 1 unused; `mainBrush` bit 2; `rightWheel` bit 3; `leftWheel` bit 4. True means overcurrent. |
| `buttons` | 18, u8, 0…255 | `clean`, `spot`, `dock`, `minute`, `hour`, `day`, `schedule`, `clock`, in bit order 0…7. True means pressed. |
| `chargingSources` | 34, u8, 0…3 | `internalCharger` bit 0; `homeBase` bit 1; numeric `raw` retains the byte. Presence indicates powered source, not charging activity. |
| `chargingSourcesAvailable` | 32, reserved u8 | Decoder applies the same shape as packet 34, but packet 32 is unused in this OI specification. **Not an alternate charging source.** Omit for custom rovers. |
| `lightBumper` | 45, u8, documented 0…127 | `left`, `frontLeft`, `centerLeft`, `centerRight`, `frontRight`, `right`, in bit order 0…5. Bits 6/7 have no exposed member. |

Example (all available fields of these two objects):

```json
{"bumpsAndWheelDrops":{"bumpRight":false,"bumpLeft":true,"wheelDropRight":false,"wheelDropLeft":false},"chargingSources":{"internalCharger":false,"homeBase":true,"raw":2}}
```

### Enumerations and derived speeds

`chargingState` (packet 21) and `oiMode` (packet 35) are objects with numeric `code` and string `label`. Binary decoding supplies these exact lowercase labels:

| Charging code | Label |
| --- | --- |
| 0 | `not charging` |
| 1 | `reconditioning charging` |
| 2 | `full charging` |
| 3 | `trickle charging` |
| 4 | `waiting` |
| 5 | `charging fault` |

| OI mode code | Label |
| --- | --- |
| 1 | `off` |
| 2 | `passive` |
| 3 | `safe` |
| 4 | `full` |

The OI document lists mode codes 0…3; the supported rovers and original working decoder use 1…4 as above. This repository preserves that observed mapping in both hardware state and diagnostic labels. Custom JSON clients should use roverState for operational mode, not infer it from these codes.

Unexpected binary codes retain their numeric value and get label `unknown`. Direct JSON does not cross-check code against label. These are diagnostics; they cannot set drivingMode, docked, or battery flags.

`wheelSpeedsMmPerSecond` is an object with numeric/null `left`, `right`, and `center`. Positive is forward, negative is reverse; center is the mean of left and right. It has no OI packet number or fixed JSON min/max. Binary Roomba input derives it from encoders; direct JSON supplies it explicitly. Missing samples/baselines must not be represented as measured zero.

### IR codes and UI interpretation

For Roomba 600 docks the OI values are: 161 force field, 164 green buoy, 165 green plus force field, 168 red buoy, 169 red plus force field, 172 both buoys, 173 both plus force field. 160 is reserved and 162 is virtual wall. Older Discovery docks use 242 force field, 244 green, 246 green plus field, 248 red, 250 red plus field, 252 both, 254 both plus field; 240 is reserved. These are identifiers, not intensity or distance.

Remote codes: 129 left, 130 forward, 131 right, 132 spot, 133 max, 134 small, 135 medium, 136 large/clean, 137 stop, 138 power, 139 arc left, 140 arc right, 141 stop, 142 download, 143 seek dock. Auto-on virtual walls encode `0LLLL0BB`: LLLL is the wall ID (1–10 assigned, 11 unbound, 12–15 reserved), and BB selects fence/force field/green/red as 0/1/2/3. See the OI document's device table for the original definitions.

| Readings | Existing use and scale |
| --- | --- |
| Bumps, wheel drops, cliff booleans, virtual wall | Existing HUD and applicable help/protection rules. Missing is not evidence of a clear sensor. |
| Cliff analog signals | Map intensity clamps signal/4095 to 0…1. Boolean cliff detection is separate. |
| Light-bump analog signals | Proximity visualization; map scale is dynamic, with a minimum ceiling of 1200. **1200 is not the sensor maximum.** |
| Wheel currents and overcurrent flags | Motor readouts and protection. |
| Measured wheel speeds | Motion display and protection, not an odometer. |
| Battery voltage/current/charge/capacity and OI codes | Diagnostic displays only. Operational battery/dock/drive decisions use roverState. |
| IR codes | Dock-beam visualization; unknown codes do not create new widgets. |
| Buttons | Diagnostic display and existing private-rover button handling. |

For a different chassis, map only signals with equivalent meaning. A centimetre range measurement is not a Roomba light-bump intensity. Unavailable geometry-specific sensors should be omitted rather than populated with invented values.

## Commands and acknowledgements

Server commands carry a unique `id`. Return an acknowledgement with the same ID:

```json
{"type":"ack","id":"command-id","status":"ok"}
```

On rejection: `{"type":"ack","id":"command-id","status":"error","error":"reason"}`. Unsupported commands must return an error. Acceptance does not claim an asynchronous action has finished.

| Command | Payload / behavior |
| --- | --- |
| `drive` | `driveDirect: {left, right}`; signed mm/s. Zero speeds stop ordinary driving. |
| `undock` | Optional `backoff` boolean (default true), `speed` mm/s maximum for reverse. Perform local preparation/backoff and stop in driving mode. |
| `dockAssist` | Prepare user-driven docking; stop on contact and arrange charging locally. Rover manages camera positioning and assist speed limiting; server only requests the action and displays reported state. Already docked is a no-op. |
| `autoDock` | Begin autonomous dock-seeking. Repeated requests must not restart an active seek. |
| `cancelDocking` | Interrupt docking/undocking and stop; exit assist through the server action. |
| `servo` | `servo: {angle}` or `{nudge}` in degrees, or `{pulseUs}` for supported hardware. |
| `headlight`, `laser` | Matching object with `action`: on/off/toggle. |
| `tts` | `tts: {text, engine?, voice?, pitch?, speed?, speak?}`. |
| `horn` | `horn: {action, waveform?, freqs?}`. Existing start/stop and synthesizer settings. |
| `audioLevels` | `audioLevels: {hornGain?, ttsGain?, forwardGain?}`. |
| `peripheral` | `peripheral: {id, control, value}`; accessory-addressed value. |
| `motors` | Roomba `motorPwm: {main, side, vacuum}`; signed -127…127 brushes, 0…127 vacuum. |
| `song` | Roomba `song: {slot?, notes:[{note,duration}], loop?}`; OI note numbers and 1/64-second duration. |
| `raw` | Base64 `raw` Roomba OI bytes; explicit diagnostics, not generic docking. |
| `sensorStream` | Roomba `sensorStream: {enable:true}` restart request. |

### Command values and actual roverd behavior

Send one command payload per message. Most ordinary handlers dispatch by the populated payload member; do not combine unrelated payloads and rely on handler order. Commands without an ID are ignored by official roverd.

- **Drive:** integer left/right wheel speeds are clamped to ±configured maxWheelSpeed (official configuration 1…500 mm/s). Positive moves forward. Example: `{"type":"drive","id":"d1","driveDirect":{"left":100,"right":100}}`.
- **Undock:** backoff defaults true. Optional integer speed is a reverse magnitude, clamped by roverd to 1…maxWheelSpeed. The server supplies a protection-limited speed. backoff false performs preparation without backing away. Other docking commands have no nested payload.
- **Servo:** numeric angle is an absolute angle, nudge a signed relative change, pulseUs an integer raw pulse duration. Send exactly one. If more are supplied, handling prefers angle, then nudge, then pulseUs. The selected controller applies configured limits; raw pulses require allowRawPulse.
- **Headlight/laser:** action is `on`, `off`, or `toggle`. Disabled roles return an error. State updates follow successful changes.
- **Motors:** integer main and side clamp to -127…127, vacuum to 0…127. These are PWM settings, not RPM or percentages.
- **TTS:** send `speak:true`; omitted/false speak does not speak. Text is trimmed and truncated to 512 Unicode code points. Engine defaults to configured defaultEngine. Accepted engines: `espeak`/`e`, `flite`/`f`, `google`/`chromegtts`/`googletts`/`gtts`. Voice defaults to configured defaultVoice. eSpeak pitch uses 0…99 after defaulting/clamping; Google pitch/speed are multipliers clamped to 0.5…2.0 by its speech backend (normal value 1.0); flite uses voice but not pitch/speed. TTS is queued, so ack does not confirm audible completion.
- **Horn:** action start/on/honk starts sound; stop/off stops. waveform is sine or saw, with saw used for other/omitted values. freqs is an array in Hz; roverd keeps up to four positive entries. No usable frequencies stops the horn. Configured maxDuration bounds playback.
- **Audio levels:** optional numeric hornGain, ttsGain, forwardGain are linear multipliers clamped to 0…4; 0 mutes and 1 is unity gain. Omitted fields retain their current values.
- **Song:** 1…16 notes required. roverd accepts slot 0…4 (default 0), clamps note to 31…127 and duration to 1…255 units of 1/64 second. Although loop is present in the payload struct, the current handler does not implement looping. OI note values outside its audible range represent rests.
- **Sensor stream:** enable true restarts the configured Roomba stream; false is currently a no-op, not a stop-stream operation.
- **Raw:** base64-encoded bytes sent to Roomba serial. Mode and seek-dock requests interrupt an active local undock. Custom non-Roomba clients should reject unsupported raw/OI commands.

Examples:

```json
{"type":"undock","id":"u1","backoff":true,"speed":100}
{"type":"dockAssist","id":"a1"}
{"type":"autoDock","id":"a2"}
{"type":"cancelDocking","id":"a3"}
{"type":"servo","id":"s1","servo":{"angle":15}}
{"type":"headlight","id":"l1","headlight":{"action":"on"}}
{"type":"tts","id":"t1","tts":{"text":"Hello","engine":"google","speak":true}}
{"type":"horn","id":"h1","horn":{"action":"start","waveform":"sine","freqs":[440,660]}}
{"type":"audioLevels","id":"v1","audioLevels":{"forwardGain":0.5}}
{"type":"motors","id":"m1","motorPwm":{"main":0,"side":50,"vacuum":0}}
{"type":"song","id":"n1","song":{"slot":0,"notes":[{"note":72,"duration":16}]}}
{"type":"sensorStream","id":"r1","sensorStream":{"enable":true}}
{"type":"raw","id":"r2","raw":"gA=="}
```

The last example is byte 128 (Roomba Start/passive); it is not a generic drive-mode request.

The browser's existing `enterDocking` action is translated by the server to `dockAssist`. Reboot/update belong on management.

Undock sends a final result on the control connection:

```json
{"type":"commandResult","id":"command-id","status":"ok"}
```

Failure/cancellation uses `status: "error"` or `"cancelled"` and `error`. The physical state still comes from `roverState`. Official roverd bounds undocking, stops on lost hardware/control connection, and ignores ordinary browser input during the operation. Server wheel protection may reduce/stop the reverse. Auto-dock completion is represented by docked state; official roverd stops wheels and auxiliary motors on contact, immediately requests charging, and ends manual assistance when charging is confirmed. No stationary-wheel wait is used. There is no generic accessory feedback stream.

Official roverd limits assisted driving to 60 mm/s, aims the camera at its configured minimum angle, and restores the previous camera angle when assistance ends. Cancellation, undocking, auto-docking, explicit OI mode changes, and control-connection loss also end assistance. Assist entry/exit and contact/contact-loss play the original OI beeps. First contact latches a local movement stop until explicit undocking. Contact loss does not restore Full mode, release held controls, or restart auto-docking; manual assistance remains active until charging is confirmed or cancelled. Held drive/motor commands cannot override the contact stop. These behaviors belong to roverd; other rover implementations may provide different assistance. The server does not issue camera-position commands or impose an assist-specific speed limit.

## Accessories

### Server-facing peripheral declaration

Hello `peripherals` is an ordered array. Each entry has:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | Nonempty string | Peripheral address, unique within the current rover inventory. Commands use this exact string. |
| `name` | Nonempty string | Display name, not the command address. |
| `controls` | Array | Controls in display/registration order. IDs must be unique within this peripheral. |

Every control has nonempty string `id`, `name`, and one of the four `type` values below. The additional properties depend on type:

| Type | Required properties | Command value | UI behavior |
| --- | --- | --- | --- |
| `slider` | Integer `min`, `max`, with min ≤ max | Integer, inclusive min…max | Drag control; changes send values. |
| `number` | Integer `min`, `max`, with min ≤ max | Integer, inclusive min…max | Numeric entry. |
| `button` | `mode:"toggle"` | Boolean | Clicking sends the opposite locally displayed value. |
| `button` | `mode:"momentary"` | Boolean | Press sends true; release/cancellation sends false. The UI also releases on permission loss/unmount. |
| `text` | Positive integer `maxLength` | String | Submitted text; roverd counts Unicode code points for the limit. |

There are no enum/select controls, fractional slider steps, units, sensor feedback, initial-value declarations, or arbitrary extra control types in this interface. `mode` applies to buttons; `min/max` to numeric controls; `maxLength` to text. Do not omit numeric bounds just because a bound is zero. The server-facing declaration has **no `output`, pin mapping, or `roverControls`**.

Complete example containing every generic control form:

```json
{
  "type": "hello",
  "name": "example",
  "maxWheelSpeed": 300,
  "peripherals": [
    {
      "id": "accessory-board",
      "name": "Accessory board",
      "controls": [
        {"id":"brightness","name":"Brightness","type":"slider","min":0,"max":255},
        {"id":"angle","name":"Arm angle","type":"number","min":0,"max":180},
        {"id":"lamp","name":"Lamp","type":"button","mode":"toggle"},
        {"id":"trigger","name":"Trigger","type":"button","mode":"momentary"},
        {"id":"display","name":"Display text","type":"text","maxLength":80}
      ]
    }
  ]
}
```

The corresponding commands are ordinary control-channel messages:

```json
{"type":"peripheral","id":"cmd-1","peripheral":{"id":"accessory-board","control":"brightness","value":128}}
{"type":"peripheral","id":"cmd-2","peripheral":{"id":"accessory-board","control":"angle","value":90}}
{"type":"peripheral","id":"cmd-3","peripheral":{"id":"accessory-board","control":"lamp","value":true}}
{"type":"peripheral","id":"cmd-4","peripheral":{"id":"accessory-board","control":"trigger","value":true}}
{"type":"peripheral","id":"cmd-5","peripheral":{"id":"accessory-board","control":"trigger","value":false}}
{"type":"peripheral","id":"cmd-6","peripheral":{"id":"accessory-board","control":"display","value":"Hello"}}
```

In blocks containing multiple JSON objects, each object is a separate WebSocket message, not one JSON document.

The outer id identifies the command/ack; nested peripheral.id identifies the device. Acknowledge each command separately. Unknown devices/controls and out-of-range or wrong-type values produce errors. Valid values must be sent explicitly; null is not a supported control value. The UI's remembered value is not measured accessory feedback. An ack confirms command handling only.

### Local peripheral hardware description

This is a **different object**, exchanged between a peripheral and official roverd. A custom rover communicating directly with the server needs only the server-facing declaration above. This local description explains the hardware options supported by official roverd.

The local object contains string `name`, ordered `controls`, and optional `roverControls`. roverd assigns identities such as firmata-0, firmata-1, and pi-gpio; use the advertised ID rather than guessing it; it strips hardware mappings before advertising controls. Each generic control has the fields above plus a required `output`:

| output.type | Other fields | Allowed control types | Effect |
| --- | --- | --- | --- |
| `digital` | Integer `pin` 0…127; optional boolean `activeLow` | button | Digital pin; activeLow reverses electrical polarity. |
| `pwm` | Integer `pin` 0…127 | slider, number | Firmata PWM output; usable resolution depends on the board. |
| `servo` | Integer `pin` 0…127 | slider, number | Firmata servo output. |
| `custom` | No pin required | Any of the four types | Board handles the addressed control value itself. |

The declaration validator checks control/type combinations and pin address bounds. The actual device must support the selected pin mode. Numeric min/max are application bounds; declaring an arbitrary maximum does not increase a pin's PWM resolution.

Example local declaration:

```json
{
  "name":"Accessory board",
  "controls":[
    {"id":"brightness","name":"Brightness","type":"slider","min":0,"max":255,"output":{"type":"pwm","pin":5}},
    {"id":"angle","name":"Arm angle","type":"number","min":0,"max":180,"output":{"type":"servo","pin":6}},
    {"id":"lamp","name":"Lamp","type":"button","mode":"toggle","output":{"type":"digital","pin":7,"activeLow":false}},
    {"id":"trigger","name":"Trigger","type":"button","mode":"momentary","output":{"type":"custom"}},
    {"id":"display","name":"Display text","type":"text","maxLength":80,"output":{"type":"custom"}}
  ]
}
```

Optional `roverControls` supplies named roles instead of creating generic accessory widgets:

| Role | Complete fields |
| --- | --- |
| `cameraServo` | Integer `pin` 0…127; numeric `minimumAngleDegrees`, `maximumAngleDegrees`, `homeAngleDegrees`, `nudgeDegrees`; integer `minimumPulseMicroseconds`, `maximumPulseMicroseconds`; boolean `allowRawPulse`, `inverted`. |
| `headlight`, `laser` | Integer `pin` 0…127; boolean `activeLow`, `initiallyOn`. |

Camera minimum must be less than maximum; home must lie inside the angle interval; nudge must be positive; pulse minimum must be positive and less than maximum. Boolean properties default false when omitted. Example role object to add to a local declaration:

```json
{
  "roverControls": {
    "cameraServo": {
      "pin":9,
      "minimumAngleDegrees":-45,
      "maximumAngleDegrees":45,
      "homeAngleDegrees":0,
      "nudgeDegrees":5,
      "minimumPulseMicroseconds":1000,
      "maximumPulseMicroseconds":2000,
      "allowRawPulse":false,
      "inverted":false
    },
    "headlight":{"pin":10,"activeLow":false,"initiallyOn":false},
    "laser":{"pin":11,"activeLow":false,"initiallyOn":false}
  }
}
```

Named roles use the dedicated servo/headlight/laser commands. Headlight and laser have their existing roverState fields; this does not introduce feedback for generic accessory controls. The [Firmata implementation](../rover/roverd/firmata.go) owns local serial framing; those bytes are not part of the rover/server WebSocket messages.

## Management

### Hello and configuration

Management hello has these fields:

| Field | Type / contents |
| --- | --- |
| `type` | `"hello"` |
| `name` | Same rover identity as the control channel. |
| `config` | Complete current roverd configuration object. |
| `schema` | JSON Schema for that config, used by the editor. |
| `profiles` | Object with `video`, `audioCapture`, `audioPlayback` arrays of profile objects. |
| `mediaStatus` | Object mapping those category names to current status strings. |
| `updateStatus` | Latest update result object, or null if unavailable. |

The server holds these in memory. Management can connect independently of control. A custom control-only rover does not need to implement config editing, host stats, profiles, or self-update.

A profile has five string fields: `id`, `name`, `description`, `setup`, `run`. Setup and run are full command strings, including newlines where needed, not paths to scripts provided by this protocol. The catalog includes built-in profiles and each category's optional custom profile. Name and run must be nonempty; setup and description may be empty.

Config's root fields are `name`, `description`, `color`, `serverUrl`, `serial`, `battery`, `maxWheelSpeed`, `media`, `audio`, `horn`, `autoSideBrush`, `private`, and `piGpio`. The overlapping hello objects are described above. Additional configuration shapes:

- `serial`: string device and positive integer baud.
- `autoSideBrush`: boolean enabled, integer speed.
- `piGpio`: boolean enabled and nested brc, cameraServo, headlight, laser. Disabling it disables the Pi peripheral.
- `piGpio.brc`: boolean enabled, integer gpioPin, string gpioChip, and duration strings pulseEvery/pulseWidth.
- `serverUrl`: rover control WebSocket URL; management uses its host with path /rover/management.

For a config update, take the complete object from hello, edit fields according to the supplied schema, and send the complete object back. The schema is part of the wire exchange; this document does not prescribe a second set of installation defaults.

### Management commands

All carry string id and receive ack with the same id, status ok/error, and error text on failure.

| Type | Additional fields | Behavior |
| --- | --- | --- |
| `config.set` | Complete object `config` | Decode, validate, stop motion, save, and restart roverd. |
| `profile.set` | String `category`, object `profile`, optional complete `config` | Replace that category's one custom profile, optionally save config, then restart. Category must be video/audioCapture/audioPlayback. Saved profile ID is forced to custom. |
| `reboot` | Optional `reboot:{"delayMs":300}` | Stop motion and reboot host. Default delay 300 ms; positive overrides clamp to 50…5000 ms. |
| `update` | No additional fields needed | Stop motion and invoke the fixed self-update helper. It uses the configured repository checkout, not a URL or executable sent by the browser. |

Saving a custom profile does not by itself select it; the corresponding media config profile must be `"custom"`. Supply the complete updated config with profile.set to select it in the same request. Saving profile plus config is not an atomic transaction across both files; a later save error can occur after the custom profile was written.

Example profile request (saves the profile, without changing selection):

```json
{
  "type":"profile.set",
  "id":"p1",
  "category":"video",
  "profile":{
    "id":"custom",
    "name":"My camera",
    "description":"Local H.264 camera publisher",
    "setup":"",
    "run":"ffmpeg -nostdin -f v4l2 -i /dev/video0 -an -c:v libx264 -f rtsp -rtsp_transport tcp \"$ROVER_VIDEO_PUBLISH_URL\""
  }
}
```

```json
{"type":"reboot","id":"reboot-1","reboot":{"delayMs":500}}
{"type":"update","id":"update-1"}
{"type":"ack","id":"update-1","status":"ok"}
```

An update ack means the action was accepted, not that installation succeeded. Read updateStatus for the outcome. Config/profile saves restart even if the successful ack cannot reach the server; reconnect hello reports the saved configuration. Unknown command types and invalid configs/profiles return errors. While a management action is pending, another action is rejected.

### Events and raw command output

Event envelope:

```json
{"type":"event","event":"media.output","ts":1795000000000,"data":{"category":"video","message":"frame output from the process\n"}}
```

| event | data |
| --- | --- |
| `media.output` | String category and message. Message is actual child output, not a status. Chunks need not match lines; append in arrival order. |
| `media.status` | String category and message. Status examples: disabled, setup, running, stopped, or explanatory failure/retry text. |
| `autoCharge.timerStarted` | Numeric chargingState OI code. |
| `autoCharge.timerCleared` | Numeric durationMs. |
| `autoCharge.seekDockIssued` | Numeric waitingMs. |
| `autoCharge.seekDockError` | String error. |
| `system.rebootStarting`, `system.updateStarting` | No required data fields. |
| `system.rebootFailed`, `system.updateFailed` | String error. |
| `tts.error` | String error from asynchronous speech execution. |
| `daemon.notice` | String message; daemon/operator notices including connection and peripheral failures. |
| `sensorWatchdog.restart`, `sensorWatchdog.ok`, `sensorWatchdog.error` | restart/ok carry numeric idleMs; error carries string error. ok confirms recovery commands were sent, not that telemetry has resumed. |

Media event delivery is best effort: roverd does not block a child process on a full event queue, and there is no replay cursor. Output can be lost during disconnect/queue overflow. Current mediaStatus is included in the next hello; old stdout is not reconstructed.

Update messages use a separate envelope:

```json
{"type":"updateStatus","status":{"state":"succeeded","message":"Update installed and roverd service restarted","timestamp":1795000000000}}
```

Status state is running/succeeded/failed, message is human-readable, timestamp is Unix milliseconds. Official roverd polls its persisted update-status file once a second and sends changes; reconnect hello includes the latest saved result.

### Host statistics

```json
{"type":"hostStats","ts":1795000000000,"stats":{"uptimeSec":3600,"cpuTempC":52.5,"cpuUsedPct":25,"memoryUsedPct":40}}
```

Stats properties are optional; omitted values are unavailable. They describe the Linux host, not the rover battery or movement.

| Fields | Type / units |
| --- | --- |
| `uptimeSec` | Number, seconds since host boot |
| `cpuTempC`, `coreVoltageV` | Number, °C / volts |
| `cpuUsedPct`, `memoryUsedPct`, `diskUsedPct` | Number, percent |
| `loadAvg1m` | Number, one-minute Linux load average |
| `memoryTotalKb`, `memoryAvailableKb` | Unsigned integer, Linux meminfo KiB |
| `diskTotalBytes`, `diskFreeBytes` | Unsigned integer bytes |
| `throttledRaw` | String, platform throttle diagnostic |
| `undervoltageNow`, `undervoltageSeen`, `frequencyCappedNow`, `frequencyCappedSeen`, `throttledNow`, `throttledSeen`, `softTempLimitNow`, `softTempLimitSeen` | Boolean current/history flags, when available |
| `errors` | Object mapping collector names to error strings |
| `wifi` | Object described below |

WiFi fields: string ssidSample; integer frequencyMhz; numeric signalDbm/noiseDbm; numeric quality/qualityMax (native signal-quality scale, not guaranteed percent); numeric rxBitrateMbit/txBitrateMbit in Mbit/s; unsigned integer rxBytes/txBytes/rxPackets/txPackets counters; numeric downloadMbps/uploadMbps measured rates; integer inactiveMs. Network rates need a preceding sample and may be absent on first connection.

Management carries these host stats, daemon notices, profile/config changes, logs, reboot, and update. It does not carry roverState, sensor frames, or driving commands.

## Media

Official roverd derives RTSP addresses from the configured server host, RTSP port (default 8554), and rover name. Video publishes at `/<name>`, microphone at `/<name>-audio`, and forwarded audio is consumed at `/<name>-fwd`. Refer to the actual derived URLs in management config/media metadata when selecting a custom publisher. See `rover-media-profiles.md` for command environment variables and profile editing.

## Minimal custom-client sequence

1. Open `/rover`, send hello with name and wheel-speed limit.
2. Send complete roverState, using null for unavailable facts.
3. Send JSON sensor snapshots if sensors exist; state reporting does not require sensors.
4. Receive a drive/docking command, handle or reject it, and acknowledge its ID.
5. Report changed physical state; send an undock command result when that operation ends.
6. Respond to WebSocket pings. On reconnect, resend hello and complete state.

No capability negotiation or alternate supported roverd implementation is implied by this example.
