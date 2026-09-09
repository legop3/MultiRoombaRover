package roverd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	peripheralStartupWait      = 2 * time.Second
	peripheralHandshakeTimeout = 5 * time.Second
	peripheralFirmwareName     = "RoverPeripheralFirmata"
)

// RoverPeripheralMetadata is the part of a peripheral description that leaves
// roverd. Pin numbers and output mappings intentionally remain private to the
// rover process; the server and browser identify only the declared control.
type RoverPeripheralMetadata struct {
	ID       string                   `json:"id"`
	Name     string                   `json:"name"`
	Controls []RoverPeripheralControl `json:"controls"`
}

// RoverPeripheralControl contains only fields needed to render and operate one
// of the four generic UI controls. Pointer fields preserve legitimate zero
// bounds while still omitting properties that do not apply to a control type.
type RoverPeripheralControl struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	Mode          string `json:"mode,omitempty"`
	Minimum       *int   `json:"min,omitempty"`
	Maximum       *int   `json:"max,omitempty"`
	MaximumLength *int   `json:"maxLength,omitempty"`
}

type managedPeripheral struct {
	metadata     RoverPeripheralMetadata
	description  PeripheralDescription
	controls     map[string]PeripheralControl
	client       *FirmataClient
	connection   io.ReadWriteCloser
	devicePath   string
	capabilities [][]FirmataPinCapability
}

// PeripheralManager owns the immutable boot-time inventory and every serial
// connection behind it. The inventory never changes after discovery, even if a
// USB device later disappears; a process restart is the only rescan mechanism.
type PeripheralManager struct {
	mu          sync.RWMutex
	peripherals []*managedPeripheral
	byID        map[string]*managedPeripheral
	cancel      context.CancelFunc
	closeOnce   sync.Once
	logger      *log.Logger
}

type peripheralDiscoveryDependencies struct {
	listCandidates func(excludedDevice string) ([]string, error)
	open           func(devicePath string) (io.ReadWriteCloser, error)
	sleep          func(time.Duration)
	startupWait    time.Duration
	handshakeWait  time.Duration
}

func discoverPeripheralManager(ctx context.Context, excludedDevice string, logger *log.Logger, dependencies peripheralDiscoveryDependencies) (*PeripheralManager, error) {
	managerContext, cancel := context.WithCancel(ctx)
	manager := &PeripheralManager{
		byID:   make(map[string]*managedPeripheral),
		cancel: cancel,
		logger: logger,
	}

	candidates, err := dependencies.listCandidates(excludedDevice)
	if err != nil {
		manager.Close()
		return nil, fmt.Errorf("list peripheral serial devices: %w", err)
	}

	for _, devicePath := range candidates {
		connection, err := dependencies.open(devicePath)
		if err != nil {
			logger.Printf("skipping peripheral candidate %s: open failed: %v", devicePath, err)
			continue
		}

		// UART bridge and native-USB development boards may reset when opened.
		// Waiting and then draining boot fragments gives the handshake a fresh
		// parser boundary instead of occasionally starting inside an old SysEx.
		dependencies.sleep(dependencies.startupWait)
		if err := drainPeripheralSerial(connection); err != nil {
			connection.Close()
			logger.Printf("skipping peripheral candidate %s: drain failed: %v", devicePath, err)
			continue
		}

		client := NewFirmataClient(connection)
		client.Start(managerContext)
		firmware, err := queryPeripheralFirmware(managerContext, client, dependencies.handshakeWait)
		if err != nil {
			connection.Close()
			logger.Printf("skipping peripheral candidate %s: Firmata query failed: %v", devicePath, err)
			continue
		}
		if firmware.Name != peripheralFirmwareName {
			connection.Close()
			logger.Printf("skipping Firmata device %s: firmware %q does not expose rover peripherals", devicePath, firmware.Name)
			continue
		}

		capabilities, err := queryPeripheralCapabilities(managerContext, client, dependencies.handshakeWait)
		if err != nil {
			connection.Close()
			manager.Close()
			return nil, fmt.Errorf("query capabilities from rover peripheral %s: %w", devicePath, err)
		}
		description, err := queryPeripheralDescription(managerContext, client, dependencies.handshakeWait)
		if err != nil {
			connection.Close()
			manager.Close()
			return nil, fmt.Errorf("describe rover peripheral %s: %w", devicePath, err)
		}

		peripheral := newManagedPeripheral(len(manager.peripherals), devicePath, connection, client, description, capabilities)
		if err := peripheral.initializeStandardOutputs(); err != nil {
			connection.Close()
			manager.Close()
			return nil, fmt.Errorf("initialize rover peripheral %s: %w", devicePath, err)
		}
		manager.peripherals = append(manager.peripherals, peripheral)
		manager.byID[peripheral.metadata.ID] = peripheral
		logger.Printf("discovered rover peripheral %s on %s with %d generic controls", description.Name, devicePath, len(description.Controls))
	}

	return manager, nil
}

func listPeripheralCandidates(excludedDevice string) ([]string, error) {
	patterns := []string{
		"/dev/serial/by-id/*",
		"/dev/ttyUSB*",
		"/dev/ttyACM*",
	}
	var matchesInPreferenceOrder []string

	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return nil, err
		}
		sort.Strings(matches)
		matchesInPreferenceOrder = append(matchesInPreferenceOrder, matches...)
	}
	return uniquePeripheralCandidates(matchesInPreferenceOrder, excludedDevice), nil
}

func uniquePeripheralCandidates(matches []string, excludedDevice string) []string {
	excludedCanonical := canonicalDevicePath(excludedDevice)
	seen := make(map[string]struct{})
	var candidates []string
	for _, match := range matches {
		canonical := canonicalDevicePath(match)
		if canonical == excludedCanonical {
			continue
		}
		if _, exists := seen[canonical]; exists {
			continue
		}
		seen[canonical] = struct{}{}
		// /dev/serial/by-id matches are passed first, so retaining the first
		// spelling favors stable names while still removing each tty alias.
		candidates = append(candidates, match)
	}
	return candidates
}

func canonicalDevicePath(devicePath string) string {
	if devicePath == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(devicePath)
	if err == nil {
		return resolved
	}
	abs, err := filepath.Abs(devicePath)
	if err == nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(devicePath)
}

func drainPeripheralSerial(connection io.Reader) error {
	buffer := make([]byte, 256)
	for {
		_, err := connection.Read(buffer)
		if errors.Is(err, io.EOF) {
			// tarm/serial uses EOF to mean its short read timeout elapsed. That
			// quiet interval is precisely the boundary needed before handshaking.
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func queryPeripheralFirmware(ctx context.Context, client *FirmataClient, timeout time.Duration) (FirmataFirmware, error) {
	queryContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return client.QueryFirmware(queryContext)
}

func queryPeripheralCapabilities(ctx context.Context, client *FirmataClient, timeout time.Duration) ([][]FirmataPinCapability, error) {
	queryContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return client.QueryCapabilities(queryContext)
}

func queryPeripheralDescription(ctx context.Context, client *FirmataClient, timeout time.Duration) (PeripheralDescription, error) {
	queryContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return client.Describe(queryContext)
}

func newManagedPeripheral(index int, devicePath string, connection io.ReadWriteCloser, client *FirmataClient, description PeripheralDescription, capabilities [][]FirmataPinCapability) *managedPeripheral {
	controls := make(map[string]PeripheralControl, len(description.Controls))
	metadataControls := make([]RoverPeripheralControl, 0, len(description.Controls))
	for _, control := range description.Controls {
		controls[control.ID] = control
		metadataControls = append(metadataControls, RoverPeripheralControl{
			ID:            control.ID,
			Type:          control.Type,
			Name:          control.Name,
			Mode:          control.Mode,
			Minimum:       cloneIntPointer(control.Minimum),
			Maximum:       cloneIntPointer(control.Maximum),
			MaximumLength: cloneIntPointer(control.MaximumLength),
		})
	}

	return &managedPeripheral{
		metadata: RoverPeripheralMetadata{
			ID:       fmt.Sprintf("firmata-%d", index),
			Name:     description.Name,
			Controls: metadataControls,
		},
		description:  description,
		controls:     controls,
		client:       client,
		connection:   connection,
		devicePath:   devicePath,
		capabilities: capabilities,
	}
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func (peripheral *managedPeripheral) initializeStandardOutputs() error {
	if camera := peripheral.description.RoverControls.CameraServo; camera != nil {
		if err := peripheral.requirePinMode("cameraServo", camera.Pin, FirmataPinModeServo); err != nil {
			return err
		}
	}
	if headlight := peripheral.description.RoverControls.Headlight; headlight != nil {
		if err := peripheral.requirePinMode("headlight", headlight.Pin, FirmataPinModeOutput); err != nil {
			return err
		}
	}
	if laser := peripheral.description.RoverControls.Laser; laser != nil {
		if err := peripheral.requirePinMode("laser", laser.Pin, FirmataPinModeOutput); err != nil {
			return err
		}
	}

	for _, control := range peripheral.description.Controls {
		if control.Output.Type == "custom" {
			continue
		}
		pin := byte(*control.Output.Pin)
		requiredMode := FirmataPinModeOutput
		if control.Output.Type == "pwm" {
			requiredMode = FirmataPinModePWM
		} else if control.Output.Type == "servo" {
			requiredMode = FirmataPinModeServo
		}
		if err := peripheral.requirePinMode("control "+control.ID, int(pin), requiredMode); err != nil {
			return err
		}
		switch control.Output.Type {
		case "digital":
			if err := peripheral.client.SetPinMode(pin, FirmataPinModeOutput); err != nil {
				return fmt.Errorf("configure control %q as digital: %w", control.ID, err)
			}
			// A generic button begins logically off. Active-low hardware needs a
			// high electrical level to represent that same initial state.
			if err := peripheral.client.SetDigitalPin(pin, control.Output.ActiveLow); err != nil {
				return fmt.Errorf("initialize digital control %q: %w", control.ID, err)
			}
		case "pwm":
			if err := peripheral.client.SetPinMode(pin, FirmataPinModePWM); err != nil {
				return fmt.Errorf("configure control %q as PWM: %w", control.ID, err)
			}
		case "servo":
			if err := peripheral.client.SetPinMode(pin, FirmataPinModeServo); err != nil {
				return fmt.Errorf("configure control %q as servo: %w", control.ID, err)
			}
		}
	}
	return nil
}

func (peripheral *managedPeripheral) requirePinMode(owner string, pin int, requiredMode byte) error {
	if pin < 0 || pin >= len(peripheral.capabilities) {
		return fmt.Errorf("%s advertises pin %d, but Firmata reported only %d pins", owner, pin, len(peripheral.capabilities))
	}
	for _, capability := range peripheral.capabilities[pin] {
		if capability.Mode == requiredMode {
			return nil
		}
	}
	return fmt.Errorf("%s advertises pin %d without required Firmata mode 0x%02x", owner, pin, requiredMode)
}

// HasRoverRole reports whether discovery found an ESP32 implementation of one
// established rover control. It is used only for startup selection and logging;
// commands continue to target the selected controller interface directly.
func (manager *PeripheralManager) HasRoverRole(role string) bool {
	return len(manager.roverRoleProviders(role)) > 0
}

func (manager *PeripheralManager) roverRoleProviders(role string) []*managedPeripheral {
	if manager == nil {
		return nil
	}
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	var providers []*managedPeripheral
	for _, peripheral := range manager.peripherals {
		switch role {
		case "cameraServo":
			if peripheral.description.RoverControls.CameraServo != nil {
				providers = append(providers, peripheral)
			}
		case "headlight":
			if peripheral.description.RoverControls.Headlight != nil {
				providers = append(providers, peripheral)
			}
		case "laser":
			if peripheral.description.RoverControls.Laser != nil {
				providers = append(providers, peripheral)
			}
		}
	}
	return providers
}

// NewFirmataCameraServo constructs the shared camera controller only when a
// discovered peripheral declared that standardized role. Absence is a normal
// disabled-feature result rather than an error.
func (manager *PeripheralManager) NewFirmataCameraServo(logger *log.Logger) (CameraServoController, error) {
	providers := manager.roverRoleProviders("cameraServo")
	if len(providers) == 0 {
		return nil, nil
	}
	if len(providers) > 1 {
		return nil, duplicateRoverRoleError("cameraServo", providers)
	}
	peripheral := providers[0]
	return newFirmataCameraServo(peripheral, *peripheral.description.RoverControls.CameraServo, logger)
}

// NewFirmataToggle resolves either standardized digital role without exposing
// the peripheral connection or ESP32 pin to WSClient.
func (manager *PeripheralManager) NewFirmataToggle(role string, logger *log.Logger) (ToggleController, error) {
	providers := manager.roverRoleProviders(role)
	if len(providers) == 0 {
		return nil, nil
	}
	if len(providers) > 1 {
		return nil, duplicateRoverRoleError(role, providers)
	}
	peripheral := providers[0]
	var declaration *PeripheralDigitalRole
	switch role {
	case "headlight":
		declaration = peripheral.description.RoverControls.Headlight
	case "laser":
		declaration = peripheral.description.RoverControls.Laser
	default:
		return nil, fmt.Errorf("unknown Firmata toggle role %q", role)
	}
	return newFirmataToggle(role, peripheral, *declaration, logger)
}

func duplicateRoverRoleError(role string, providers []*managedPeripheral) error {
	providerIDs := make([]string, 0, len(providers))
	for _, provider := range providers {
		providerIDs = append(providerIDs, provider.metadata.ID)
	}
	return fmt.Errorf("rover peripheral role %s has multiple providers: %s", role, strings.Join(providerIDs, ", "))
}

// Inventory returns a defensive copy in startup order. Server reconnects reuse
// this same list and therefore never cause a USB rescan or ID reassignment.
func (manager *PeripheralManager) Inventory() []RoverPeripheralMetadata {
	if manager == nil {
		return nil
	}
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	inventory := make([]RoverPeripheralMetadata, 0, len(manager.peripherals))
	for _, peripheral := range manager.peripherals {
		metadata := peripheral.metadata
		metadata.Controls = make([]RoverPeripheralControl, 0, len(peripheral.metadata.Controls))
		for _, control := range peripheral.metadata.Controls {
			control.Minimum = cloneIntPointer(control.Minimum)
			control.Maximum = cloneIntPointer(control.Maximum)
			control.MaximumLength = cloneIntPointer(control.MaximumLength)
			metadata.Controls = append(metadata.Controls, control)
		}
		inventory = append(inventory, metadata)
	}
	return inventory
}

// SetControl validates the browser-shaped value against the ESP32 declaration,
// then uses the private output mapping selected during startup. Neither the
// server nor browser can choose a pin or switch a custom control into raw GPIO.
func (manager *PeripheralManager) SetControl(peripheralID, controlID string, rawValue json.RawMessage) error {
	if manager == nil {
		return errors.New("rover peripherals disabled")
	}
	manager.mu.RLock()
	peripheral := manager.byID[peripheralID]
	manager.mu.RUnlock()
	if peripheral == nil {
		return fmt.Errorf("unknown peripheral %q", peripheralID)
	}
	control, exists := peripheral.controls[controlID]
	if !exists {
		return fmt.Errorf("unknown control %q on peripheral %q", controlID, peripheralID)
	}

	value, err := decodePeripheralControlValue(control, rawValue)
	if err != nil {
		return fmt.Errorf("control %q: %w", controlID, err)
	}

	switch control.Output.Type {
	case "digital":
		enabled := value.(bool)
		if control.Output.ActiveLow {
			enabled = !enabled
		}
		return peripheral.client.SetDigitalPin(byte(*control.Output.Pin), enabled)
	case "pwm", "servo":
		return peripheral.client.ExtendedAnalog(byte(*control.Output.Pin), value.(int))
	case "custom":
		return peripheral.client.SendPeripheralControl(control.ID, value)
	default:
		return fmt.Errorf("control has unsupported output %q", control.Output.Type)
	}
}

func decodePeripheralControlValue(control PeripheralControl, rawValue json.RawMessage) (any, error) {
	if len(rawValue) == 0 {
		return nil, errors.New("value is required")
	}

	switch control.Type {
	case "slider", "number":
		var value int
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return nil, errors.New("value must be a whole number")
		}
		if value < *control.Minimum || value > *control.Maximum {
			return nil, fmt.Errorf("value must be between %d and %d", *control.Minimum, *control.Maximum)
		}
		return value, nil
	case "button":
		var value bool
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return nil, errors.New("value must be true or false")
		}
		return value, nil
	case "text":
		var value string
		if err := json.Unmarshal(rawValue, &value); err != nil {
			return nil, errors.New("value must be text")
		}
		if utf8.RuneCountInString(value) > *control.MaximumLength {
			return nil, fmt.Errorf("value must contain at most %d characters", *control.MaximumLength)
		}
		return value, nil
	default:
		return nil, fmt.Errorf("unsupported control type %q", control.Type)
	}
}

// Close releases every discovered USB connection exactly once. It does not
// alter inventory or attempt to reconnect devices because shutdown/restart is
// the lifecycle boundary chosen for this feature.
func (manager *PeripheralManager) Close() {
	if manager == nil {
		return
	}
	manager.closeOnce.Do(func() {
		manager.cancel()
		manager.mu.Lock()
		defer manager.mu.Unlock()
		for _, peripheral := range manager.peripherals {
			if err := peripheral.connection.Close(); err != nil {
				manager.logger.Printf("close rover peripheral %s on %s: %v", peripheral.metadata.ID, peripheral.devicePath, err)
			}
		}
	})
}
