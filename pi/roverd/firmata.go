package roverd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

// Firmata command and mode constants are kept here instead of scattering raw
// bytes through the peripheral code. The values come directly from the Firmata
// protocol, so captures from a rover can be compared with the specification.
const (
	firmataReportVersion     byte = 0xF9
	firmataSetPinMode        byte = 0xF4
	firmataSetDigitalPin     byte = 0xF5
	firmataStartSysex        byte = 0xF0
	firmataEndSysex          byte = 0xF7
	firmataReportFirmware    byte = 0x79
	firmataCapabilityQuery   byte = 0x6B
	firmataCapabilityReply   byte = 0x6C
	firmataExtendedAnalog    byte = 0x6F
	firmataServoConfig       byte = 0x70
	firmataPeripheralFeature byte = 0x01

	firmataPeripheralDescribe    byte = 0x00
	firmataPeripheralDescription byte = 0x01
	firmataPeripheralControl     byte = 0x02
	firmataMaximumSysexDataBytes      = 252

	FirmataPinModeOutput byte = 0x01
	FirmataPinModePWM    byte = 0x03
	FirmataPinModeServo  byte = 0x04
)

// FirmataMessage is the transport-neutral result of parsing one complete
// Firmata message. For SysEx messages Command is the SysEx feature byte and
// Data is everything between that feature byte and END_SYSEX.
type FirmataMessage struct {
	Command byte
	Data    []byte
	Sysex   bool
}

// FirmataParser incrementally parses a byte stream. USB serial reads may split
// a message anywhere or combine several messages, so parsing whole Read calls
// as though they were packets would intermittently corrupt valid traffic.
type FirmataParser struct {
	inSysex  bool
	sysex    []byte
	command  byte
	data     []byte
	expected int
}

// Feed accepts any fragment of the serial stream and returns every complete
// message found in it, preserving wire order.
func (p *FirmataParser) Feed(fragment []byte) ([]FirmataMessage, error) {
	var messages []FirmataMessage

	for _, value := range fragment {
		if p.inSysex {
			switch {
			case value == firmataEndSysex:
				if len(p.sysex) == 0 {
					p.resetSysex()
					return messages, errors.New("Firmata SysEx message is missing a feature byte")
				}
				messages = append(messages, FirmataMessage{
					Command: p.sysex[0],
					Data:    append([]byte(nil), p.sysex[1:]...),
					Sysex:   true,
				})
				p.resetSysex()
			case value&0x80 != 0:
				// Bytes inside SysEx must be seven-bit clean. Reset immediately so
				// a damaged frame cannot consume every later message on the port.
				p.resetSysex()
				return messages, fmt.Errorf("invalid 8-bit value 0x%02x inside Firmata SysEx", value)
			default:
				p.sysex = append(p.sysex, value)
			}
			continue
		}

		if value == firmataStartSysex {
			p.inSysex = true
			p.sysex = p.sysex[:0]
			p.resetFixed()
			continue
		}

		if value&0x80 != 0 {
			p.command = value
			p.data = p.data[:0]
			p.expected = firmataDataLength(value)
			if p.expected == 0 {
				messages = append(messages, FirmataMessage{Command: value})
				p.resetFixed()
			}
			continue
		}

		// Stray data before a status byte is harmless serial noise. Firmata
		// has no framing information that could assign it to a command.
		if p.expected == 0 {
			continue
		}
		p.data = append(p.data, value)
		if len(p.data) == p.expected {
			messages = append(messages, FirmataMessage{
				Command: p.command,
				Data:    append([]byte(nil), p.data...),
			})
			p.resetFixed()
		}
	}

	return messages, nil
}

func (p *FirmataParser) resetSysex() {
	p.inSysex = false
	p.sysex = p.sysex[:0]
}

func (p *FirmataParser) resetFixed() {
	p.command = 0
	p.data = p.data[:0]
	p.expected = 0
}

// firmataDataLength returns the number of seven-bit data bytes used by the
// fixed-length messages relevant to normal Firmata traffic. Unknown system
// commands are treated as single-byte messages so they cannot stall parsing of
// the rover-peripheral SysEx frames that follow them.
func firmataDataLength(command byte) int {
	switch command {
	case firmataReportVersion, firmataSetPinMode, firmataSetDigitalPin:
		return 2
	}

	switch command & 0xF0 {
	case 0x80, 0x90, 0xA0, 0xE0:
		return 2
	case 0xC0, 0xD0:
		return 1
	default:
		return 0
	}
}

// EncodeFirmata7Bit converts arbitrary bytes into the two-byte representation
// required inside Firmata SysEx. Keeping this transform below the JSON layer
// means firmware authors and UI code never need to think about wire encoding.
func EncodeFirmata7Bit(raw []byte) []byte {
	encoded := make([]byte, 0, len(raw)*2)
	for _, value := range raw {
		encoded = append(encoded, value&0x7F, (value>>7)&0x01)
	}
	return encoded
}

// DecodeFirmata7Bit reverses EncodeFirmata7Bit and rejects malformed pairs.
func DecodeFirmata7Bit(encoded []byte) ([]byte, error) {
	if len(encoded)%2 != 0 {
		return nil, fmt.Errorf("Firmata 7-bit payload has odd length %d", len(encoded))
	}

	decoded := make([]byte, 0, len(encoded)/2)
	for index := 0; index < len(encoded); index += 2 {
		low, high := encoded[index], encoded[index+1]
		if low&0x80 != 0 || high > 1 {
			return nil, fmt.Errorf("invalid Firmata 7-bit pair at byte %d", index)
		}
		decoded = append(decoded, low|(high<<7))
	}
	return decoded, nil
}

// PeripheralDescription is generated by the ESP32 at boot. Controls is a slice
// intentionally: registration order is part of the UI contract and must never
// be replaced by map iteration or alphabetical sorting.
type PeripheralDescription struct {
	Name          string                  `json:"name"`
	RoverControls PeripheralRoverControls `json:"roverControls,omitempty"`
	Controls      []PeripheralControl     `json:"controls"`
}

type PeripheralRoverControls struct {
	CameraServo *PeripheralCameraServo `json:"cameraServo,omitempty"`
	Headlight   *PeripheralDigitalRole `json:"headlight,omitempty"`
	Laser       *PeripheralDigitalRole `json:"laser,omitempty"`
}

type PeripheralCameraServo struct {
	Pin                      int     `json:"pin"`
	MinimumAngleDegrees      float64 `json:"minimumAngleDegrees"`
	MaximumAngleDegrees      float64 `json:"maximumAngleDegrees"`
	HomeAngleDegrees         float64 `json:"homeAngleDegrees"`
	NudgeDegrees             float64 `json:"nudgeDegrees"`
	MinimumPulseMicroseconds int     `json:"minimumPulseMicroseconds"`
	MaximumPulseMicroseconds int     `json:"maximumPulseMicroseconds"`
	AllowRawPulse            bool    `json:"allowRawPulse"`
	Inverted                 bool    `json:"inverted"`
}

type PeripheralDigitalRole struct {
	Pin         int  `json:"pin"`
	ActiveLow   bool `json:"activeLow"`
	InitiallyOn bool `json:"initiallyOn"`
}

type PeripheralControl struct {
	ID            string           `json:"id"`
	Type          string           `json:"type"`
	Name          string           `json:"name"`
	Mode          string           `json:"mode,omitempty"`
	Minimum       *int             `json:"min,omitempty"`
	Maximum       *int             `json:"max,omitempty"`
	MaximumLength *int             `json:"maxLength,omitempty"`
	Output        PeripheralOutput `json:"output"`
}

type PeripheralOutput struct {
	Type      string `json:"type"`
	Pin       *int   `json:"pin,omitempty"`
	ActiveLow bool   `json:"activeLow,omitempty"`
}

// Validate catches authoring mistakes at connection time, where the error can
// name the offending peripheral, instead of allowing a malformed declaration
// to turn into a confusing no-op later when a driver uses the control.
func (description PeripheralDescription) Validate() error {
	if description.Name == "" {
		return errors.New("peripheral description requires a name")
	}
	if camera := description.RoverControls.CameraServo; camera != nil {
		if err := validateFirmataPin("cameraServo", camera.Pin); err != nil {
			return err
		}
		if camera.MinimumAngleDegrees >= camera.MaximumAngleDegrees {
			return errors.New("cameraServo angle range must be increasing")
		}
		if camera.HomeAngleDegrees < camera.MinimumAngleDegrees || camera.HomeAngleDegrees > camera.MaximumAngleDegrees {
			return errors.New("cameraServo home angle must be inside its angle range")
		}
		if camera.NudgeDegrees <= 0 {
			return errors.New("cameraServo nudge must be positive")
		}
		if camera.MinimumPulseMicroseconds <= 0 || camera.MaximumPulseMicroseconds <= camera.MinimumPulseMicroseconds {
			return errors.New("cameraServo pulse range must be positive and increasing")
		}
	}
	if role := description.RoverControls.Headlight; role != nil {
		if err := validateFirmataPin("headlight", role.Pin); err != nil {
			return err
		}
	}
	if role := description.RoverControls.Laser; role != nil {
		if err := validateFirmataPin("laser", role.Pin); err != nil {
			return err
		}
	}

	seen := make(map[string]struct{}, len(description.Controls))
	for index, control := range description.Controls {
		if control.ID == "" || control.Name == "" {
			return fmt.Errorf("control %d requires both id and name", index)
		}
		if _, exists := seen[control.ID]; exists {
			return fmt.Errorf("control id %q is duplicated", control.ID)
		}
		seen[control.ID] = struct{}{}

		switch control.Type {
		case "slider", "number":
			if control.Minimum == nil || control.Maximum == nil || *control.Minimum > *control.Maximum {
				return fmt.Errorf("control %q requires a valid min and max", control.ID)
			}
		case "button":
			if control.Mode != "toggle" && control.Mode != "momentary" {
				return fmt.Errorf("button %q requires toggle or momentary mode", control.ID)
			}
		case "text":
			if control.MaximumLength == nil || *control.MaximumLength <= 0 {
				return fmt.Errorf("text control %q requires a positive maxLength", control.ID)
			}
		default:
			return fmt.Errorf("control %q has unsupported type %q", control.ID, control.Type)
		}

		switch control.Output.Type {
		case "digital":
			if control.Output.Pin == nil {
				return fmt.Errorf("control %q output %q requires a pin", control.ID, control.Output.Type)
			}
			if err := validateFirmataPin("control "+control.ID, *control.Output.Pin); err != nil {
				return err
			}
			if control.Type != "button" {
				return fmt.Errorf("digital output control %q must be a button", control.ID)
			}
		case "pwm", "servo":
			if control.Output.Pin == nil {
				return fmt.Errorf("control %q output %q requires a pin", control.ID, control.Output.Type)
			}
			if err := validateFirmataPin("control "+control.ID, *control.Output.Pin); err != nil {
				return err
			}
			if control.Type != "slider" && control.Type != "number" {
				return fmt.Errorf("%s output control %q must be a slider or number", control.Output.Type, control.ID)
			}
		case "custom":
		default:
			return fmt.Errorf("control %q has unsupported output %q", control.ID, control.Output.Type)
		}
	}

	return nil
}

func validateFirmataPin(owner string, pin int) error {
	// Firmata represents pin numbers with one seven-bit byte. Rejecting values
	// outside that wire range avoids silently wrapping a declaration when it is
	// converted to a byte for output commands.
	if pin < 0 || pin > 127 {
		return fmt.Errorf("%s pin must be between 0 and 127", owner)
	}
	return nil
}

// FirmataFirmware identifies the implementation answering the standard
// REPORT_FIRMWARE query. It is diagnostic metadata, not a protocol gate.
type FirmataFirmware struct {
	Major int
	Minor int
	Name  string
}

// FirmataPinCapability is one mode/resolution pair from CAPABILITY_RESPONSE.
type FirmataPinCapability struct {
	Mode       byte
	Resolution byte
}

// FirmataClient owns one already-open serial connection. Its reader goroutine
// separates arbitrary USB read boundaries from request/response handling while
// writeMu prevents two commands from interleaving on the byte stream.
type FirmataClient struct {
	connection  io.ReadWriteCloser
	parser      FirmataParser
	messages    chan FirmataMessage
	errors      chan error
	writeMu     sync.Mutex
	requestMu   sync.Mutex
	stateMu     sync.RWMutex
	terminalErr error
}

func NewFirmataClient(connection io.ReadWriteCloser) *FirmataClient {
	return &FirmataClient{
		connection: connection,
		messages:   make(chan FirmataMessage, 16),
		errors:     make(chan error, 1),
	}
}

// Start begins consuming the serial stream. The caller still owns the port and
// closes it during shutdown; this makes the client usable with both real serial
// ports and deterministic in-memory test connections.
func (client *FirmataClient) Start(ctx context.Context) {
	go client.readLoop(ctx)
}

func (client *FirmataClient) readLoop(ctx context.Context) {
	buffer := make([]byte, 256)
	for {
		count, err := client.connection.Read(buffer)
		if count > 0 {
			messages, parseErr := client.parser.Feed(buffer[:count])
			if parseErr != nil {
				client.publishError(ctx, parseErr)
				return
			}
			for _, message := range messages {
				select {
				case client.messages <- message:
				case <-ctx.Done():
					return
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				// tarm/serial represents an ordinary ReadTimeout with io.EOF. A
				// Firmata connection is expected to be quiet between commands, so
				// treating that timeout as a closed device kills the reader before
				// the next request can receive its reply. A real USB removal is
				// reported by the serial driver as a non-EOF error.
				select {
				case <-ctx.Done():
					return
				default:
					continue
				}
			}
			client.publishError(ctx, err)
			return
		}

		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

func (client *FirmataClient) publishError(ctx context.Context, err error) {
	client.stateMu.Lock()
	if client.terminalErr == nil {
		client.terminalErr = err
	}
	client.stateMu.Unlock()

	select {
	case client.errors <- err:
	case <-ctx.Done():
	default:
	}
}

func (client *FirmataClient) write(message []byte) error {
	client.writeMu.Lock()
	defer client.writeMu.Unlock()
	client.stateMu.RLock()
	terminalErr := client.terminalErr
	client.stateMu.RUnlock()
	if terminalErr != nil {
		return fmt.Errorf("Firmata connection unavailable: %w", terminalErr)
	}

	written, err := client.connection.Write(message)
	if err != nil {
		return err
	}
	if written != len(message) {
		return fmt.Errorf("short Firmata write %d/%d", written, len(message))
	}
	return nil
}

func (client *FirmataClient) writeSysex(command byte, data []byte) error {
	message := make([]byte, 0, len(data)+3)
	message = append(message, firmataStartSysex, command)
	message = append(message, data...)
	message = append(message, firmataEndSysex)
	return client.write(message)
}

func (client *FirmataClient) waitFor(ctx context.Context, match func(FirmataMessage) bool) (FirmataMessage, error) {
	for {
		select {
		case message := <-client.messages:
			if match(message) {
				return message, nil
			}
		case err := <-client.errors:
			return FirmataMessage{}, err
		case <-ctx.Done():
			return FirmataMessage{}, ctx.Err()
		}
	}
}

func (client *FirmataClient) QueryFirmware(ctx context.Context) (FirmataFirmware, error) {
	client.requestMu.Lock()
	defer client.requestMu.Unlock()

	if err := client.writeSysex(firmataReportFirmware, nil); err != nil {
		return FirmataFirmware{}, err
	}
	message, err := client.waitFor(ctx, func(message FirmataMessage) bool {
		return message.Sysex && message.Command == firmataReportFirmware
	})
	if err != nil {
		return FirmataFirmware{}, err
	}
	if len(message.Data) < 2 {
		return FirmataFirmware{}, errors.New("Firmata firmware response is missing version bytes")
	}
	name, err := DecodeFirmata7Bit(message.Data[2:])
	if err != nil {
		return FirmataFirmware{}, fmt.Errorf("decode Firmata firmware name: %w", err)
	}
	return FirmataFirmware{Major: int(message.Data[0]), Minor: int(message.Data[1]), Name: string(name)}, nil
}

func (client *FirmataClient) QueryCapabilities(ctx context.Context) ([][]FirmataPinCapability, error) {
	client.requestMu.Lock()
	defer client.requestMu.Unlock()

	if err := client.writeSysex(firmataCapabilityQuery, nil); err != nil {
		return nil, err
	}
	message, err := client.waitFor(ctx, func(message FirmataMessage) bool {
		return message.Sysex && message.Command == firmataCapabilityReply
	})
	if err != nil {
		return nil, err
	}
	return parseFirmataCapabilities(message.Data)
}

func parseFirmataCapabilities(data []byte) ([][]FirmataPinCapability, error) {
	var pins [][]FirmataPinCapability
	var pin []FirmataPinCapability
	for index := 0; index < len(data); {
		if data[index] == 0x7F {
			pins = append(pins, pin)
			pin = nil
			index++
			continue
		}
		if index+1 >= len(data) {
			return nil, errors.New("Firmata capability response ends inside a mode pair")
		}
		pin = append(pin, FirmataPinCapability{Mode: data[index], Resolution: data[index+1]})
		index += 2
	}
	if pin != nil {
		return nil, errors.New("Firmata capability response is missing its final pin separator")
	}
	return pins, nil
}

func (client *FirmataClient) Describe(ctx context.Context) (PeripheralDescription, error) {
	client.requestMu.Lock()
	defer client.requestMu.Unlock()

	if err := client.writeSysex(firmataPeripheralFeature, []byte{firmataPeripheralDescribe}); err != nil {
		return PeripheralDescription{}, err
	}
	message, err := client.waitFor(ctx, func(message FirmataMessage) bool {
		return message.Sysex && message.Command == firmataPeripheralFeature && len(message.Data) > 0 && message.Data[0] == firmataPeripheralDescription
	})
	if err != nil {
		return PeripheralDescription{}, err
	}

	raw, err := DecodeFirmata7Bit(message.Data[1:])
	if err != nil {
		return PeripheralDescription{}, fmt.Errorf("decode peripheral description: %w", err)
	}
	var description PeripheralDescription
	if err := json.Unmarshal(raw, &description); err != nil {
		return PeripheralDescription{}, fmt.Errorf("parse peripheral description: %w", err)
	}
	if err := description.Validate(); err != nil {
		return PeripheralDescription{}, fmt.Errorf("validate peripheral description: %w", err)
	}
	return description, nil
}

func (client *FirmataClient) SetPinMode(pin, mode byte) error {
	return client.write([]byte{firmataSetPinMode, pin & 0x7F, mode & 0x7F})
}

func (client *FirmataClient) SetDigitalPin(pin byte, enabled bool) error {
	value := byte(0)
	if enabled {
		value = 1
	}
	return client.write([]byte{firmataSetDigitalPin, pin & 0x7F, value})
}

func (client *FirmataClient) ExtendedAnalog(pin byte, value int) error {
	if value < 0 {
		return fmt.Errorf("Firmata analog value cannot be negative: %d", value)
	}

	payload := []byte{pin & 0x7F}
	// Firmata encodes integers as many seven-bit chunks as necessary. Zero
	// still needs one value byte so the receiver can distinguish it from a
	// message that contains only the pin.
	for {
		payload = append(payload, byte(value&0x7F))
		value >>= 7
		if value == 0 {
			break
		}
	}
	return client.writeSysex(firmataExtendedAnalog, payload)
}

func (client *FirmataClient) ConfigureServo(pin byte, minimumPulseMicroseconds, maximumPulseMicroseconds int) error {
	if minimumPulseMicroseconds <= 0 || maximumPulseMicroseconds <= minimumPulseMicroseconds {
		return errors.New("servo pulse range must be positive and increasing")
	}
	payload := []byte{
		pin & 0x7F,
		byte(minimumPulseMicroseconds & 0x7F), byte((minimumPulseMicroseconds >> 7) & 0x7F),
		byte(maximumPulseMicroseconds & 0x7F), byte((maximumPulseMicroseconds >> 7) & 0x7F),
	}
	return client.writeSysex(firmataServoConfig, payload)
}

func (client *FirmataClient) SendPeripheralControl(controlID string, value any) error {
	payload, err := json.Marshal(struct {
		Control string `json:"control"`
		Value   any    `json:"value"`
	}{Control: controlID, Value: value})
	if err != nil {
		return fmt.Errorf("encode peripheral control: %w", err)
	}
	data := append([]byte{firmataPeripheralControl}, EncodeFirmata7Bit(payload)...)
	// ConfigurableFirmata on ESP32 stores at most 252 bytes including the SysEx
	// feature byte. Refuse a value that the board would otherwise discard as an
	// incomplete frame; this is a transport constraint, not an application-level
	// text policy.
	if len(data)+1 > firmataMaximumSysexDataBytes {
		return fmt.Errorf("peripheral control needs %d SysEx data bytes; Firmata accepts at most %d", len(data)+1, firmataMaximumSysexDataBytes)
	}
	return client.writeSysex(firmataPeripheralFeature, data)
}
