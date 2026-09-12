package roverd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestFirmataParserHandlesFragmentedSysex(t *testing.T) {
	parser := FirmataParser{}

	first, err := parser.Feed([]byte{firmataStartSysex, firmataPeripheralFeature, firmataPeripheralDescription, 1})
	if err != nil {
		t.Fatalf("first fragment: %v", err)
	}
	if len(first) != 0 {
		t.Fatalf("first fragment unexpectedly produced %d messages", len(first))
	}

	second, err := parser.Feed([]byte{0, 2, 0, firmataEndSysex})
	if err != nil {
		t.Fatalf("second fragment: %v", err)
	}
	want := []FirmataMessage{{
		Command: firmataPeripheralFeature,
		Data:    []byte{firmataPeripheralDescription, 1, 0, 2, 0},
		Sysex:   true,
	}}
	if !reflect.DeepEqual(second, want) {
		t.Fatalf("messages = %#v, want %#v", second, want)
	}
}

func TestFirmataParserReturnsSeveralMessagesFromOneRead(t *testing.T) {
	parser := FirmataParser{}
	messages, err := parser.Feed([]byte{
		firmataReportVersion, 2, 5,
		firmataStartSysex, firmataCapabilityReply, 0x01, 0x01, 0x7F, firmataEndSysex,
		firmataSetDigitalPin, 18, 1,
	})
	if err != nil {
		t.Fatalf("feed: %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("got %d messages, want 3", len(messages))
	}
	if messages[0].Command != firmataReportVersion || messages[1].Command != firmataCapabilityReply || messages[2].Command != firmataSetDigitalPin {
		t.Fatalf("commands were not preserved in wire order: %#v", messages)
	}
}

func TestFirmataParserRejectsEightBitSysexDataAndRecovers(t *testing.T) {
	parser := FirmataParser{}
	if _, err := parser.Feed([]byte{firmataStartSysex, firmataPeripheralFeature, 0x80}); err == nil {
		t.Fatal("expected invalid SysEx data to fail")
	}

	messages, err := parser.Feed([]byte{firmataReportVersion, 2, 5})
	if err != nil {
		t.Fatalf("feed after invalid SysEx: %v", err)
	}
	if len(messages) != 1 || messages[0].Command != firmataReportVersion {
		t.Fatalf("parser did not recover: %#v", messages)
	}
}

func TestFirmataSevenBitRoundTripIncludesUTF8(t *testing.T) {
	raw := []byte(`{"name":"Café lights","value":255}`)
	encoded := EncodeFirmata7Bit(raw)
	for index, value := range encoded {
		if value&0x80 != 0 {
			t.Fatalf("encoded byte %d is not seven-bit clean: 0x%02x", index, value)
		}
	}
	decoded, err := DecodeFirmata7Bit(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !bytes.Equal(decoded, raw) {
		t.Fatalf("decoded %q, want %q", decoded, raw)
	}
}

func TestDecodeFirmataSevenBitRejectsMalformedPairs(t *testing.T) {
	for name, encoded := range map[string][]byte{
		"odd length": {1},
		"high byte":  {1, 2},
		"eight bit":  {0x80, 0},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeFirmata7Bit(encoded); err == nil {
				t.Fatal("expected malformed pair to fail")
			}
		})
	}
}

func TestPeripheralDescriptionPreservesControlOrder(t *testing.T) {
	raw := []byte(`{
		"name":"Test peripheral",
		"controls":[
			{"id":"servo","type":"slider","name":"Servo","min":0,"max":180,"output":{"type":"servo","pin":14}},
			{"id":"lights","type":"slider","name":"Lights","min":0,"max":255,"output":{"type":"pwm","pin":18}},
			{"id":"action","type":"button","name":"Action","mode":"momentary","output":{"type":"custom"}}
		]
	}`)
	var description PeripheralDescription
	if err := json.Unmarshal(raw, &description); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if err := description.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	want := []string{"servo", "lights", "action"}
	for index, id := range want {
		if description.Controls[index].ID != id {
			t.Fatalf("control %d = %q, want %q", index, description.Controls[index].ID, id)
		}
	}
}

func TestPeripheralDescriptionRejectsInvalidDeclarations(t *testing.T) {
	minimum, maximum, pin := 10, 1, 200
	for name, description := range map[string]PeripheralDescription{
		"duplicate id": {
			Name: "device",
			Controls: []PeripheralControl{
				{ID: "same", Name: "First", Type: "button", Mode: "toggle", Output: PeripheralOutput{Type: "custom"}},
				{ID: "same", Name: "Second", Type: "button", Mode: "toggle", Output: PeripheralOutput{Type: "custom"}},
			},
		},
		"reversed range": {
			Name: "device",
			Controls: []PeripheralControl{{
				ID: "level", Name: "Level", Type: "slider", Minimum: &minimum, Maximum: &maximum, Output: PeripheralOutput{Type: "custom"},
			}},
		},
		"pin outside Firmata": {
			Name: "device",
			Controls: []PeripheralControl{{
				ID: "switch", Name: "Switch", Type: "button", Mode: "toggle", Output: PeripheralOutput{Type: "digital", Pin: &pin},
			}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := description.Validate(); err == nil {
				t.Fatal("expected invalid description to fail")
			}
		})
	}
}

func TestParseFirmataCapabilities(t *testing.T) {
	pins, err := parseFirmataCapabilities([]byte{
		FirmataPinModeOutput, 1, FirmataPinModePWM, 8, 0x7F,
		FirmataPinModeOutput, 1, FirmataPinModeServo, 14, 0x7F,
	})
	if err != nil {
		t.Fatalf("parse capabilities: %v", err)
	}
	if len(pins) != 2 || len(pins[0]) != 2 || pins[1][1].Mode != FirmataPinModeServo {
		t.Fatalf("unexpected capabilities: %#v", pins)
	}

	if _, err := parseFirmataCapabilities([]byte{FirmataPinModeOutput}); err == nil {
		t.Fatal("expected incomplete capability pair to fail")
	}
}

func TestFirmataClientWritesStandardCommands(t *testing.T) {
	connection := &recordingConnection{}
	client := NewFirmataClient(connection)

	if err := client.SetPinMode(14, FirmataPinModeServo); err != nil {
		t.Fatalf("set pin mode: %v", err)
	}
	if err := client.ConfigureServo(14, 900, 2100); err != nil {
		t.Fatalf("configure servo: %v", err)
	}
	if err := client.ExtendedAnalog(14, 180); err != nil {
		t.Fatalf("extended analog: %v", err)
	}
	if err := client.SetDigitalPin(19, true); err != nil {
		t.Fatalf("digital write: %v", err)
	}

	want := []byte{
		firmataSetPinMode, 14, FirmataPinModeServo,
		firmataStartSysex, firmataServoConfig, 14, 4, 7, 52, 16, firmataEndSysex,
		firmataStartSysex, firmataExtendedAnalog, 14, 52, 1, firmataEndSysex,
		firmataSetDigitalPin, 19, 1,
	}
	if got := connection.Bytes(); !bytes.Equal(got, want) {
		t.Fatalf("wire bytes = %v, want %v", got, want)
	}
}

func TestFirmataClientQueriesAndDecodesDescription(t *testing.T) {
	descriptionJSON := []byte(`{"name":"Bench device","controls":[{"id":"go","type":"button","name":"Go","mode":"momentary","output":{"type":"custom"}}]}`)
	firmwareName := EncodeFirmata7Bit([]byte("RoverPeripheralFirmata"))
	description := append([]byte{firmataStartSysex, firmataPeripheralFeature, firmataPeripheralDescription}, EncodeFirmata7Bit(descriptionJSON)...)
	description = append(description, firmataEndSysex)

	connection := newScriptedConnection(
		append(append([]byte{firmataStartSysex, firmataReportFirmware, 1, 0}, firmwareName...), firmataEndSysex),
		description,
	)
	client := NewFirmataClient(connection)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	client.Start(ctx)

	firmware, err := client.QueryFirmware(ctx)
	if err != nil {
		t.Fatalf("query firmware: %v", err)
	}
	if firmware.Name != "RoverPeripheralFirmata" || firmware.Major != 1 || firmware.Minor != 0 {
		t.Fatalf("unexpected firmware: %#v", firmware)
	}

	got, err := client.Describe(ctx)
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	if got.Name != "Bench device" || len(got.Controls) != 1 || got.Controls[0].ID != "go" {
		t.Fatalf("unexpected description: %#v", got)
	}

	writes := connection.Bytes()
	wantWrites := []byte{
		firmataStartSysex, firmataReportFirmware, firmataEndSysex,
		firmataStartSysex, firmataPeripheralFeature, firmataPeripheralDescribe, firmataEndSysex,
	}
	if !bytes.Equal(writes, wantWrites) {
		t.Fatalf("queries = %v, want %v", writes, wantWrites)
	}
}

func TestFirmataClientKeepsReadingAfterSerialTimeoutEOF(t *testing.T) {
	firmwareName := EncodeFirmata7Bit([]byte("RoverPeripheralFirmata"))
	response := append([]byte{firmataStartSysex, firmataReportFirmware, 1, 0}, firmwareName...)
	response = append(response, firmataEndSysex)

	// tarm/serial returns io.EOF when its ReadTimeout expires without bytes.
	// Reproducing that behavior before the response prevents this regression
	// from being hidden by an in-memory reader that blocks indefinitely instead.
	connection := newScriptedConnection(response)
	connection.timeoutsBeforeRead = 1
	client := NewFirmataClient(connection)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	client.Start(ctx)

	firmware, err := client.QueryFirmware(ctx)
	if err != nil {
		t.Fatalf("query firmware after timeout: %v", err)
	}
	if firmware.Name != "RoverPeripheralFirmata" {
		t.Fatalf("firmware name = %q", firmware.Name)
	}
}

func TestFirmataClientEncodesCustomControl(t *testing.T) {
	for name, testCase := range map[string]struct {
		controlID string
		value     any
		wantJSON  string
	}{
		"button": {controlID: "specialAction", value: true, wantJSON: `{"control":"specialAction","value":true}`},
		"text":   {controlID: "displayText", value: "Café ready", wantJSON: `{"control":"displayText","value":"Café ready"}`},
	} {
		t.Run(name, func(t *testing.T) {
			connection := &recordingConnection{}
			client := NewFirmataClient(connection)
			if err := client.SendPeripheralControl(testCase.controlID, testCase.value); err != nil {
				t.Fatalf("send control: %v", err)
			}

			wire := connection.Bytes()
			if len(wire) < 5 || wire[0] != firmataStartSysex || wire[1] != firmataPeripheralFeature || wire[2] != firmataPeripheralControl || wire[len(wire)-1] != firmataEndSysex {
				t.Fatalf("invalid control frame: %v", wire)
			}
			raw, err := DecodeFirmata7Bit(wire[3 : len(wire)-1])
			if err != nil {
				t.Fatalf("decode control: %v", err)
			}
			if string(raw) != testCase.wantJSON {
				t.Fatalf("control JSON = %s, want %s", raw, testCase.wantJSON)
			}
		})
	}
}

func TestFirmataClientQueriesCapabilities(t *testing.T) {
	response := []byte{
		firmataStartSysex, firmataCapabilityReply,
		FirmataPinModeOutput, 1, FirmataPinModePWM, 8, 0x7F,
		FirmataPinModeOutput, 1, FirmataPinModeServo, 14, 0x7F,
		firmataEndSysex,
	}
	connection := newScriptedConnection(response)
	client := NewFirmataClient(connection)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	client.Start(ctx)

	pins, err := client.QueryCapabilities(ctx)
	if err != nil {
		t.Fatalf("query capabilities: %v", err)
	}
	if len(pins) != 2 || pins[0][1].Mode != FirmataPinModePWM || pins[1][1].Mode != FirmataPinModeServo {
		t.Fatalf("unexpected capabilities: %#v", pins)
	}
	if want := []byte{firmataStartSysex, firmataCapabilityQuery, firmataEndSysex}; !bytes.Equal(connection.Bytes(), want) {
		t.Fatalf("query bytes = %v, want %v", connection.Bytes(), want)
	}
}

func TestFirmataClientRejectsControlTooLargeForFirmwareParser(t *testing.T) {
	connection := &recordingConnection{}
	client := NewFirmataClient(connection)
	if err := client.SendPeripheralControl("displayText", string(bytes.Repeat([]byte{'x'}, 200))); err == nil {
		t.Fatal("expected oversized control to fail")
	}
	if len(connection.Bytes()) != 0 {
		t.Fatalf("oversized control wrote bytes: %v", connection.Bytes())
	}
}

// recordingConnection is deliberately minimal: write-focused tests should not
// need goroutines or a real serial device merely to inspect exact Firmata bytes.
type recordingConnection struct {
	mu       sync.Mutex
	writes   bytes.Buffer
	closed   bool
	writeErr error
}

func (connection *recordingConnection) Read(_ []byte) (int, error) { return 0, io.EOF }

func (connection *recordingConnection) Write(data []byte) (int, error) {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.closed {
		return 0, io.ErrClosedPipe
	}
	if connection.writeErr != nil {
		return 0, connection.writeErr
	}
	return connection.writes.Write(data)
}

func (connection *recordingConnection) Close() error {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	connection.closed = true
	return nil
}

func (connection *recordingConnection) Bytes() []byte {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return append([]byte(nil), connection.writes.Bytes()...)
}

func (connection *recordingConnection) Closed() bool {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.closed
}

func (connection *recordingConnection) SetWriteError(err error) {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	connection.writeErr = err
}

// scriptedConnection releases one response after each client write. This
// mirrors request/response serial behavior and prevents a fast reader goroutine
// from publishing all scripted answers before the matching query is sent.
type scriptedConnection struct {
	recordingConnection
	responses          chan []byte
	reads              chan []byte
	timeoutsBeforeRead int
	pendingRead        []byte
	closeOnce          sync.Once
}

func newScriptedConnection(responses ...[]byte) *scriptedConnection {
	connection := &scriptedConnection{
		responses: make(chan []byte, len(responses)),
		reads:     make(chan []byte, len(responses)),
	}
	for _, response := range responses {
		connection.responses <- append([]byte(nil), response...)
	}
	return connection
}

func (connection *scriptedConnection) Read(target []byte) (int, error) {
	if connection.timeoutsBeforeRead > 0 {
		connection.timeoutsBeforeRead--
		return 0, io.EOF
	}
	if len(connection.pendingRead) == 0 {
		response, ok := <-connection.reads
		if !ok {
			return 0, io.ErrClosedPipe
		}
		connection.pendingRead = response
	}
	written := copy(target, connection.pendingRead)
	connection.pendingRead = connection.pendingRead[written:]
	return written, nil
}

func (connection *scriptedConnection) Write(data []byte) (int, error) {
	written, err := connection.recordingConnection.Write(data)
	if err == nil {
		select {
		case response := <-connection.responses:
			connection.reads <- response
		default:
		}
	}
	return written, err
}

func (connection *scriptedConnection) Close() error {
	connection.closeOnce.Do(func() {
		_ = connection.recordingConnection.Close()
		close(connection.reads)
	})
	return nil
}
