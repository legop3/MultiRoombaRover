package roverd

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"
)

func TestDisabledNativeRolesResolveToFirmataOnEveryHostBuild(t *testing.T) {
	description := PeripheralDescription{
		Name: "Rover GPIO",
		RoverControls: PeripheralRoverControls{
			CameraServo: &PeripheralCameraServo{
				Pin: 14, MinimumAngleDegrees: -15, MaximumAngleDegrees: 30,
				HomeAngleDegrees: 0, NudgeDegrees: 2,
				MinimumPulseMicroseconds: 900, MaximumPulseMicroseconds: 2100,
			},
			Headlight: &PeripheralDigitalRole{Pin: 18, ActiveLow: true, InitiallyOn: true},
			Laser:     &PeripheralDigitalRole{Pin: 16, ActiveLow: false, InitiallyOn: false},
		},
		Controls: []PeripheralControl{},
	}
	connection := scriptedPeripheralConnection(t, description)
	manager, err := discoverPeripheralManager(
		context.Background(),
		"/dev/roomba",
		discardLogger(),
		testPeripheralDiscoveryDependencies([]string{"/dev/rover-gpio"}, map[string]*scriptedConnection{"/dev/rover-gpio": connection}),
	)
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	defer manager.Close()

	// The parent switch suppresses every native role even with saved child
	// settings enabled. No GPIO provider may displace the external peripheral.
	baseline := len(connection.Bytes())
	controllers, err := ResolveRoverHardwareControllers(&Config{PiGPIO: PiGPIOConfig{
		CameraServo: CameraServoConfig{Enabled: true}, Headlight: GPIOToggleConfig{Enabled: true}, Laser: GPIOToggleConfig{Enabled: true},
	}}, manager, discardLogger())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	defer controllers.Close()
	if controllers.CameraServo == nil || controllers.Headlight == nil || controllers.Laser == nil {
		t.Fatalf("missing Firmata controller: %#v", controllers)
	}
	if !controllers.CameraServo.Configuration().Enabled || !controllers.Headlight.Configuration().Enabled || !controllers.Laser.Configuration().Enabled {
		t.Fatal("ESP32-backed roles were not advertised as enabled")
	}
	wantHardwareBroadcast := "Rover hardware ready: camera servo via ESP32 firmata-0, headlight via ESP32 firmata-0, laser via ESP32 firmata-0."
	if messages := controllers.StartupBroadcasts(); len(messages) != 1 || messages[0] != wantHardwareBroadcast {
		t.Fatalf("hardware broadcasts = %#v, want %q", messages, wantHardwareBroadcast)
	}

	// Initialization uses only standard Firmata: servo calibration and mode,
	// followed by the home position and digital initial states. The active-low
	// headlight starts logically on, so its physical output is low.
	writes := connection.Bytes()[baseline:]
	wantPrefix := []byte{
		firmataStartSysex, firmataServoConfig, 14, 4, 7, 52, 16, firmataEndSysex,
		firmataSetPinMode, 14, FirmataPinModeServo,
		firmataStartSysex, firmataExtendedAnalog, 14, 60, firmataEndSysex,
		firmataSetPinMode, 18, FirmataPinModeOutput,
		firmataSetDigitalPin, 18, 0,
		firmataSetPinMode, 16, FirmataPinModeOutput,
		firmataSetDigitalPin, 16, 0,
	}
	if !bytes.Equal(writes, wantPrefix) {
		t.Fatalf("initial controller bytes = %v, want %v", writes, wantPrefix)
	}

	baseline = len(connection.Bytes())
	if err := controllers.Headlight.HandleAction("off"); err != nil {
		t.Fatalf("turn headlight off: %v", err)
	}
	if controllers.Headlight.On() {
		t.Fatal("headlight remained logically on")
	}
	// Active-low means logical off becomes a high electrical output.
	if got, want := connection.Bytes()[baseline:], []byte{firmataSetDigitalPin, 18, 1}; !bytes.Equal(got, want) {
		t.Fatalf("headlight bytes = %v, want %v", got, want)
	}
}

func TestMissingNativeAndFirmataRolesRemainDisabled(t *testing.T) {
	manager := &PeripheralManager{byID: make(map[string]*managedPeripheral)}
	controllers, err := ResolveRoverHardwareControllers(&Config{}, manager, discardLogger())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if controllers.CameraServo != nil || controllers.Headlight != nil || controllers.Laser != nil {
		t.Fatalf("unexpected controllers without providers: %#v", controllers)
	}
}

func TestConflictingRolesRemainUnavailableWithoutInitializingGPIO(t *testing.T) {
	roleDescription := PeripheralDescription{RoverControls: PeripheralRoverControls{
		CameraServo: &PeripheralCameraServo{}, Headlight: &PeripheralDigitalRole{}, Laser: &PeripheralDigitalRole{},
	}}
	manager := &PeripheralManager{peripherals: []*managedPeripheral{
		{metadata: RoverPeripheralMetadata{ID: "firmata-0"}, description: roleDescription},
	}}
	cfg := &Config{PiGPIO: PiGPIOConfig{Enabled: true,
		CameraServo: CameraServoConfig{Enabled: true},
		Headlight:   GPIOToggleConfig{Enabled: true}, Laser: GPIOToggleConfig{Enabled: true},
	}}
	factories := nativeHardwareControllerFactories{
		newCameraServo: func(CameraServoConfig, *log.Logger) (CameraServoController, error) {
			t.Fatal("conflicting GPIO servo must not initialize")
			return nil, nil
		},
		newToggle: func(string, GPIOToggleConfig, *log.Logger) (ToggleController, error) {
			t.Fatal("conflicting GPIO toggle must not initialize")
			return nil, nil
		},
	}
	controllers, err := resolveRoverHardwareControllers(cfg, manager, discardLogger(), factories)
	if err != nil {
		t.Fatal(err)
	}
	if controllers.CameraServo != nil || controllers.Headlight != nil || controllers.Laser != nil {
		t.Fatal("conflicting roles must remain unavailable")
	}
	if len(controllers.issues) != 3 {
		t.Fatalf("expected three role conflicts, got %v", controllers.issues)
	}
	for _, issue := range controllers.issues {
		if !strings.Contains(issue, "firmata-0, pi-gpio") {
			t.Fatalf("missing provider identities: %s", issue)
		}
	}
}

type testCameraServoController struct {
	cfg CameraServoConfig
}

func (controller *testCameraServoController) SetAngle(float64) error           { return nil }
func (controller *testCameraServoController) Nudge(float64) error              { return nil }
func (controller *testCameraServoController) SetPulseWidth(int) error          { return nil }
func (controller *testCameraServoController) CurrentAngle() float64            { return 0 }
func (controller *testCameraServoController) Configuration() CameraServoConfig { return controller.cfg }
func (controller *testCameraServoController) BackendDescription() string       { return "native GPIO" }
func (controller *testCameraServoController) Close()                           {}

type testToggleController struct {
	cfg GPIOToggleConfig
	on  bool
}

func (controller *testToggleController) HandleAction(string) error       { return nil }
func (controller *testToggleController) On() bool                        { return controller.on }
func (controller *testToggleController) Configuration() GPIOToggleConfig { return controller.cfg }
func (controller *testToggleController) BackendDescription() string      { return "native GPIO" }
func (controller *testToggleController) Close()                          {}
