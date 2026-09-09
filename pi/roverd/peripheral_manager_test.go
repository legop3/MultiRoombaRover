package roverd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPeripheralManagerDiscoversInventoryAndDispatchesControls(t *testing.T) {
	description := testPeripheralDescription("Bench accessory", false)
	connection := scriptedPeripheralConnection(t, description)
	dependencies := testPeripheralDiscoveryDependencies(
		[]string{"/dev/ttyUSB9"},
		map[string]*scriptedConnection{"/dev/ttyUSB9": connection},
	)

	manager, err := discoverPeripheralManager(context.Background(), "/dev/ttyUSB0", discardLogger(), dependencies)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()

	inventory := manager.Inventory()
	if len(inventory) != 1 {
		t.Fatalf("inventory length = %d, want 1", len(inventory))
	}
	if inventory[0].ID != "firmata-0" || inventory[0].Name != "Bench accessory" {
		t.Fatalf("unexpected peripheral metadata: %#v", inventory[0])
	}
	wantBroadcast := `Rover peripheral "Bench accessory" connected as firmata-0 with 3 additional controls.`
	if broadcasts := manager.StartupBroadcasts(); len(broadcasts) != 1 || broadcasts[0] != wantBroadcast {
		t.Fatalf("startup broadcasts = %#v, want %q", broadcasts, wantBroadcast)
	}
	wantOrder := []string{"servoPosition", "lightBrightness", "specialAction"}
	for index, controlID := range wantOrder {
		if inventory[0].Controls[index].ID != controlID {
			t.Fatalf("control %d = %q, want %q", index, inventory[0].Controls[index].ID, controlID)
		}
	}
	*inventory[0].Controls[0].Minimum = 99
	if fresh := manager.Inventory(); *fresh[0].Controls[0].Minimum != 0 {
		t.Fatal("caller mutation changed the manager's fixed inventory")
	}

	// Standard modes are configured once during discovery. Runtime slider
	// commands should consequently contain only EXTENDED_ANALOG, not repeated
	// mode changes that would detach and reattach a servo while it is moving.
	baseline := len(connection.Bytes())
	if err := manager.SetControl("firmata-0", "servoPosition", json.RawMessage(`90`)); err != nil {
		t.Fatalf("set servo: %v", err)
	}
	servoWrite := connection.Bytes()[baseline:]
	wantServo := []byte{firmataStartSysex, firmataExtendedAnalog, 13, 90, firmataEndSysex}
	if !bytes.Equal(servoWrite, wantServo) {
		t.Fatalf("servo bytes = %v, want %v", servoWrite, wantServo)
	}

	baseline = len(connection.Bytes())
	if err := manager.SetControl("firmata-0", "lightBrightness", json.RawMessage(`128`)); err != nil {
		t.Fatalf("set PWM: %v", err)
	}
	pwmWrite := connection.Bytes()[baseline:]
	wantPWM := []byte{firmataStartSysex, firmataExtendedAnalog, 17, 0, 1, firmataEndSysex}
	if !bytes.Equal(pwmWrite, wantPWM) {
		t.Fatalf("PWM bytes = %v, want %v", pwmWrite, wantPWM)
	}

	baseline = len(connection.Bytes())
	if err := manager.SetControl("firmata-0", "specialAction", json.RawMessage(`true`)); err != nil {
		t.Fatalf("set custom button: %v", err)
	}
	customWrite := connection.Bytes()[baseline:]
	if len(customWrite) < 5 || customWrite[1] != firmataPeripheralFeature || customWrite[2] != firmataPeripheralControl {
		t.Fatalf("custom control did not use rover-peripheral SysEx: %v", customWrite)
	}
}

func TestPeripheralManagerBroadcastsNoDevices(t *testing.T) {
	manager := &PeripheralManager{byID: make(map[string]*managedPeripheral)}
	want := "No ESP32 rover peripherals detected during startup."
	if messages := manager.StartupBroadcasts(); len(messages) != 1 || messages[0] != want {
		t.Fatalf("startup broadcasts = %#v, want %q", messages, want)
	}
}

func TestPeripheralManagerReportsUnexpectedDisconnectOnce(t *testing.T) {
	connection := scriptedPeripheralConnection(t, testPeripheralDescription("Bench accessory", false))
	manager, err := discoverPeripheralManager(
		context.Background(),
		"/dev/roomba",
		discardLogger(),
		testPeripheralDiscoveryDependencies([]string{"/dev/accessory"}, map[string]*scriptedConnection{"/dev/accessory": connection}),
	)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()

	// Closing the fake read stream models an unplugged USB serial adapter. The
	// manager should publish one identified failure and never attempt reconnect.
	_ = connection.Close()
	select {
	case failure := <-manager.Failures():
		if failure.ID != "firmata-0" || failure.Name != "Bench accessory" || !errors.Is(failure.Err, io.ErrClosedPipe) {
			t.Fatalf("unexpected failure: %#v", failure)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for peripheral disconnect")
	}
	select {
	case duplicate := <-manager.Failures():
		t.Fatalf("unexpected duplicate disconnect: %#v", duplicate)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestPeripheralManagerRejectsInvalidValuesBeforeWriting(t *testing.T) {
	connection := scriptedPeripheralConnection(t, testPeripheralDescription("Bench accessory", false))
	manager, err := discoverPeripheralManager(
		context.Background(),
		"/dev/roomba",
		discardLogger(),
		testPeripheralDiscoveryDependencies([]string{"/dev/accessory"}, map[string]*scriptedConnection{"/dev/accessory": connection}),
	)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()

	baseline := len(connection.Bytes())
	invalid := []struct {
		control string
		value   string
	}{
		{control: "servoPosition", value: `181`},
		{control: "lightBrightness", value: `12.5`},
		{control: "specialAction", value: `"yes"`},
	}
	for _, testCase := range invalid {
		if err := manager.SetControl("firmata-0", testCase.control, json.RawMessage(testCase.value)); err == nil {
			t.Fatalf("expected %s=%s to fail", testCase.control, testCase.value)
		}
	}
	if got := len(connection.Bytes()); got != baseline {
		t.Fatalf("invalid values wrote %d bytes", got-baseline)
	}
}

func TestPeripheralManagerSkipsOtherFirmataFirmware(t *testing.T) {
	other := newScriptedConnection(testFirmwareFrame("StandardFirmata"))
	other.timeoutsBeforeRead = 1
	rover := scriptedPeripheralConnection(t, testPeripheralDescription("Rover accessory", false))
	dependencies := testPeripheralDiscoveryDependencies(
		[]string{"/dev/ttyACM0", "/dev/ttyUSB0"},
		map[string]*scriptedConnection{
			"/dev/ttyACM0": other,
			"/dev/ttyUSB0": rover,
		},
	)

	manager, err := discoverPeripheralManager(context.Background(), "/dev/roomba", discardLogger(), dependencies)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()
	if inventory := manager.Inventory(); len(inventory) != 1 || inventory[0].ID != "firmata-0" || inventory[0].Name != "Rover accessory" {
		t.Fatalf("unexpected inventory: %#v", inventory)
	}
	if !other.Closed() {
		t.Fatal("non-rover Firmata port was not closed")
	}
}

func TestPeripheralManagerFailsMalformedRoverDescription(t *testing.T) {
	connection := newScriptedConnection(
		testFirmwareFrame(peripheralFirmwareName),
		testCapabilityFrame(),
		testDescriptionFrame([]byte(`not-json`)),
	)
	connection.timeoutsBeforeRead = 1
	dependencies := testPeripheralDiscoveryDependencies(
		[]string{"/dev/ttyUSB0"},
		map[string]*scriptedConnection{"/dev/ttyUSB0": connection},
	)

	manager, err := discoverPeripheralManager(context.Background(), "/dev/roomba", discardLogger(), dependencies)
	if err == nil || !strings.Contains(err.Error(), "describe rover peripheral") {
		t.Fatalf("expected malformed description error, got manager=%v err=%v", manager, err)
	}
	if !connection.Closed() {
		t.Fatal("malformed rover peripheral connection was not closed")
	}
}

func TestPeripheralManagerRejectsAdvertisedUnsupportedPinMode(t *testing.T) {
	description := testPeripheralDescription("Bad capability", false)
	rawDescription, err := json.Marshal(description)
	if err != nil {
		t.Fatalf("marshal description: %v", err)
	}
	connection := newScriptedConnection(
		testFirmwareFrame(peripheralFirmwareName),
		[]byte{
			firmataStartSysex, firmataCapabilityReply,
			FirmataPinModeOutput, 1, 0x7F,
			firmataEndSysex,
		},
		testDescriptionFrame(rawDescription),
	)
	connection.timeoutsBeforeRead = 1
	dependencies := testPeripheralDiscoveryDependencies(
		[]string{"/dev/ttyUSB0"},
		map[string]*scriptedConnection{"/dev/ttyUSB0": connection},
	)

	manager, err := discoverPeripheralManager(context.Background(), "/dev/roomba", discardLogger(), dependencies)
	if err == nil || !strings.Contains(err.Error(), "Firmata reported only 1 pins") {
		t.Fatalf("expected unsupported capability error, got manager=%v err=%v", manager, err)
	}
	if !connection.Closed() {
		t.Fatal("unsupported peripheral connection was not closed")
	}
}

func TestPeripheralManagerRejectsDuplicateBuiltInProvidersWhenRoleIsSelected(t *testing.T) {
	first := scriptedPeripheralConnection(t, testPeripheralDescription("First", true))
	second := scriptedPeripheralConnection(t, testPeripheralDescription("Second", true))
	dependencies := testPeripheralDiscoveryDependencies(
		[]string{"/dev/ttyUSB0", "/dev/ttyUSB1"},
		map[string]*scriptedConnection{
			"/dev/ttyUSB0": first,
			"/dev/ttyUSB1": second,
		},
	)

	manager, err := discoverPeripheralManager(context.Background(), "/dev/roomba", discardLogger(), dependencies)
	if err != nil {
		t.Fatalf("discovery should retain providers until native precedence is known: %v", err)
	}
	defer manager.Close()
	if _, err := manager.NewFirmataToggle("headlight", discardLogger()); err == nil || !strings.Contains(err.Error(), "role headlight has multiple providers") {
		t.Fatalf("expected duplicate provider selection error, got %v", err)
	}
	if first.Closed() || second.Closed() {
		t.Fatal("selection validation unexpectedly closed manager-owned ports")
	}
}

func TestPeripheralManagerReturnsHardwareWriteFailure(t *testing.T) {
	connection := scriptedPeripheralConnection(t, testPeripheralDescription("Bench accessory", false))
	manager, err := discoverPeripheralManager(
		context.Background(),
		"/dev/roomba",
		discardLogger(),
		testPeripheralDiscoveryDependencies([]string{"/dev/accessory"}, map[string]*scriptedConnection{"/dev/accessory": connection}),
	)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()

	connection.SetWriteError(errors.New("USB device removed"))
	err = manager.SetControl("firmata-0", "lightBrightness", json.RawMessage(`128`))
	if err == nil || !strings.Contains(err.Error(), "USB device removed") {
		t.Fatalf("expected hardware error, got %v", err)
	}
	select {
	case failure := <-manager.Failures():
		if failure.ID != "firmata-0" || !strings.Contains(failure.Err.Error(), "USB device removed") {
			t.Fatalf("unexpected write failure notification: %#v", failure)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for write failure notification")
	}
}

func TestPeripheralManagerPassesRoombaDeviceToCandidateExclusion(t *testing.T) {
	const roombaDevice = "/dev/serial/by-id/roomba-base"
	listed := false
	dependencies := peripheralDiscoveryDependencies{
		listCandidates: func(excluded string) ([]string, error) {
			listed = true
			if excluded != roombaDevice {
				t.Fatalf("excluded device = %q, want %q", excluded, roombaDevice)
			}
			return nil, nil
		},
		open:          func(string) (io.ReadWriteCloser, error) { return nil, errors.New("unexpected open") },
		sleep:         func(time.Duration) {},
		startupWait:   0,
		handshakeWait: time.Second,
	}

	manager, err := discoverPeripheralManager(context.Background(), roombaDevice, discardLogger(), dependencies)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	manager.Close()
	if !listed {
		t.Fatal("candidate listing was not called")
	}
}

func TestUniquePeripheralCandidatesPrefersStableAliasAndExcludesRoomba(t *testing.T) {
	temporaryDirectory := t.TempDir()
	peripheralTarget := filepath.Join(temporaryDirectory, "ttyUSB0")
	roombaTarget := filepath.Join(temporaryDirectory, "ttyUSB1")
	if err := os.WriteFile(peripheralTarget, nil, 0o600); err != nil {
		t.Fatalf("create peripheral target: %v", err)
	}
	if err := os.WriteFile(roombaTarget, nil, 0o600); err != nil {
		t.Fatalf("create Roomba target: %v", err)
	}
	stableAlias := filepath.Join(temporaryDirectory, "usb-rover-peripheral")
	if err := os.Symlink(peripheralTarget, stableAlias); err != nil {
		t.Fatalf("create stable alias: %v", err)
	}

	candidates := uniquePeripheralCandidates(
		[]string{stableAlias, peripheralTarget, roombaTarget},
		roombaTarget,
	)
	if len(candidates) != 1 || candidates[0] != stableAlias {
		t.Fatalf("candidates = %v, want stable peripheral alias only", candidates)
	}
}

func testPeripheralDiscoveryDependencies(paths []string, connections map[string]*scriptedConnection) peripheralDiscoveryDependencies {
	return peripheralDiscoveryDependencies{
		listCandidates: func(string) ([]string, error) {
			return append([]string(nil), paths...), nil
		},
		open: func(devicePath string) (io.ReadWriteCloser, error) {
			connection := connections[devicePath]
			if connection == nil {
				return nil, errors.New("test connection not found")
			}
			return connection, nil
		},
		sleep:         func(time.Duration) {},
		startupWait:   0,
		handshakeWait: time.Second,
	}
}

func scriptedPeripheralConnection(t *testing.T, description PeripheralDescription) *scriptedConnection {
	t.Helper()
	rawDescription, err := json.Marshal(description)
	if err != nil {
		t.Fatalf("marshal description: %v", err)
	}
	connection := newScriptedConnection(
		testFirmwareFrame(peripheralFirmwareName),
		testCapabilityFrame(),
		testDescriptionFrame(rawDescription),
	)
	// The first read represents the quiet timeout used to drain boot output
	// before the client's parser starts consuming explicit query responses.
	connection.timeoutsBeforeRead = 1
	return connection
}

func testPeripheralDescription(name string, provideHeadlight bool) PeripheralDescription {
	minimumServo, maximumServo := 0, 180
	minimumPWM, maximumPWM := 0, 255
	servoPin, pwmPin := 13, 17
	description := PeripheralDescription{
		Name: name,
		Controls: []PeripheralControl{
			{
				ID: "servoPosition", Type: "slider", Name: "Servo position",
				Minimum: &minimumServo, Maximum: &maximumServo,
				Output: PeripheralOutput{Type: "servo", Pin: &servoPin},
			},
			{
				ID: "lightBrightness", Type: "slider", Name: "Light brightness",
				Minimum: &minimumPWM, Maximum: &maximumPWM,
				Output: PeripheralOutput{Type: "pwm", Pin: &pwmPin},
			},
			{
				ID: "specialAction", Type: "button", Name: "Run special action", Mode: "momentary",
				Output: PeripheralOutput{Type: "custom"},
			},
		},
	}
	if provideHeadlight {
		description.RoverControls.Headlight = &PeripheralDigitalRole{Pin: 18}
	}
	return description
}

func testFirmwareFrame(name string) []byte {
	frame := []byte{firmataStartSysex, firmataReportFirmware, 1, 0}
	frame = append(frame, EncodeFirmata7Bit([]byte(name))...)
	return append(frame, firmataEndSysex)
}

func testCapabilityFrame() []byte {
	frame := []byte{firmataStartSysex, firmataCapabilityReply}
	for pin := 0; pin < 40; pin++ {
		// The test ESP32 reports the same three output modes as the reference
		// firmware. Repeating real pin entries also exercises capability parsing
		// independently of any particular example control pin.
		frame = append(frame, FirmataPinModeOutput, 1, FirmataPinModePWM, 8, FirmataPinModeServo, 14, 0x7F)
	}
	return append(frame, firmataEndSysex)
}

func testDescriptionFrame(rawDescription []byte) []byte {
	frame := []byte{firmataStartSysex, firmataPeripheralFeature, firmataPeripheralDescription}
	frame = append(frame, EncodeFirmata7Bit(rawDescription)...)
	return append(frame, firmataEndSysex)
}

func discardLogger() *log.Logger {
	return log.New(io.Discard, "", 0)
}
