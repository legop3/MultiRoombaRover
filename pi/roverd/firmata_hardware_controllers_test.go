package roverd

import (
	"bytes"
	"context"
	"log"
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

	// All native entries are disabled, exactly as they can be on either a Pi or
	// laptop rover. The shared resolver must therefore select every ESP32 role.
	baseline := len(connection.Bytes())
	controllers, err := ResolveRoverHardwareControllers(&Config{}, manager, discardLogger())
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

func TestEnabledNativeRolesWinEvenWithSeveralFirmataProviders(t *testing.T) {
	roleDescription := PeripheralDescription{RoverControls: PeripheralRoverControls{
		CameraServo: &PeripheralCameraServo{},
		Headlight:   &PeripheralDigitalRole{},
		Laser:       &PeripheralDigitalRole{},
	}}
	manager := &PeripheralManager{
		byID: make(map[string]*managedPeripheral),
		peripherals: []*managedPeripheral{
			{metadata: RoverPeripheralMetadata{ID: "firmata-0"}, description: roleDescription},
			{metadata: RoverPeripheralMetadata{ID: "firmata-1"}, description: roleDescription},
		},
	}
	cfg := &Config{
		CameraServo: CameraServoConfig{Enabled: true},
		Headlight:   GPIOToggleConfig{Enabled: true},
		Laser:       GPIOToggleConfig{Enabled: true},
	}
	nativeCamera := &testCameraServoController{cfg: cfg.CameraServo}
	nativeToggles := map[string]*testToggleController{}
	factories := nativeHardwareControllerFactories{
		newCameraServo: func(_ CameraServoConfig, _ *log.Logger) (CameraServoController, error) {
			return nativeCamera, nil
		},
		newToggle: func(name string, config GPIOToggleConfig, _ *log.Logger) (ToggleController, error) {
			controller := &testToggleController{cfg: config}
			nativeToggles[name] = controller
			return controller, nil
		},
	}

	// Duplicate Firmata declarations are irrelevant when native hardware wins;
	// selection must neither fail nor initialize either ESP32 provider.
	controllers, err := resolveRoverHardwareControllers(cfg, manager, discardLogger(), factories)
	if err != nil {
		t.Fatalf("resolve native precedence: %v", err)
	}
	if controllers.CameraServo != nativeCamera || controllers.Headlight != nativeToggles["headlight"] || controllers.Laser != nativeToggles["laser"] {
		t.Fatal("resolver did not retain native controllers")
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
func (controller *testCameraServoController) Close()                           {}

type testToggleController struct {
	cfg GPIOToggleConfig
	on  bool
}

func (controller *testToggleController) HandleAction(string) error       { return nil }
func (controller *testToggleController) On() bool                        { return controller.on }
func (controller *testToggleController) Configuration() GPIOToggleConfig { return controller.cfg }
func (controller *testToggleController) Close()                          {}
