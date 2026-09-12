package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	roverd "multiroombarover/pi/roverd"

	"github.com/tarm/serial"
)

func main() {
	var portName string
	var baud int
	var timeout time.Duration
	var startupWait time.Duration
	var controlID string
	var rawValue string

	flag.StringVar(&portName, "port", "", "serial device, for example /dev/ttyUSB0 or /dev/ttyACM0")
	flag.IntVar(&baud, "baud", 115200, "Firmata serial baud rate")
	flag.DurationVar(&timeout, "timeout", 5*time.Second, "timeout for each Firmata response")
	flag.DurationVar(&startupWait, "startup-wait", 2*time.Second, "time allowed for boards that reset when the port opens")
	flag.StringVar(&controlID, "control", "", "optional declared control ID to exercise")
	flag.StringVar(&rawValue, "value", "", "JSON value for -control, such as 90, true, or \"hello\"")
	flag.Parse()

	if portName == "" {
		log.Fatal("-port is required")
	}
	if (controlID == "") != (rawValue == "") {
		log.Fatal("-control and -value must be provided together")
	}

	port, err := serial.OpenPort(&serial.Config{
		Name:        portName,
		Baud:        baud,
		ReadTimeout: 100 * time.Millisecond,
	})
	if err != nil {
		log.Fatalf("open %s: %v", portName, err)
	}
	defer port.Close()

	// CH340 and native-USB development boards may reset when the host opens the
	// port. Waiting here makes the same probe work with both connection styles
	// without baking that diagnostic delay into the production Firmata client.
	time.Sleep(startupWait)

	rootContext, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	client := roverd.NewFirmataClient(port)
	client.Start(rootContext)

	firmware, err := withTimeout(timeout, client.QueryFirmware)
	if err != nil {
		log.Fatalf("query firmware: %v", err)
	}
	fmt.Printf("Firmata firmware: %s %d.%d\n", firmware.Name, firmware.Major, firmware.Minor)

	capabilities, err := withTimeout(timeout, client.QueryCapabilities)
	if err != nil {
		log.Fatalf("query capabilities: %v", err)
	}
	fmt.Printf("Firmata pins described: %d\n", len(capabilities))

	description, err := withTimeout(timeout, client.Describe)
	if err != nil {
		log.Fatalf("describe rover peripheral: %v", err)
	}
	formatted, err := json.MarshalIndent(description, "", "  ")
	if err != nil {
		log.Fatalf("format description: %v", err)
	}
	fmt.Printf("Peripheral description:\n%s\n", formatted)

	if controlID != "" {
		if err := exerciseControl(client, description, controlID, json.RawMessage(rawValue)); err != nil {
			log.Fatalf("exercise control %q: %v", controlID, err)
		}
		fmt.Fprintf(os.Stdout, "Control %q accepted.\n", controlID)
	}
}

// withTimeout gives every boot-time exchange its own deadline. A missing board
// therefore reports the exact handshake stage that failed instead of consuming
// one shared timeout and obscuring which response was absent.
func withTimeout[T any](timeout time.Duration, operation func(context.Context) (T, error)) (T, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return operation(ctx)
}

func exerciseControl(client *roverd.FirmataClient, description roverd.PeripheralDescription, controlID string, rawValue json.RawMessage) error {
	var selected *roverd.PeripheralControl
	for index := range description.Controls {
		if description.Controls[index].ID == controlID {
			selected = &description.Controls[index]
			break
		}
	}
	if selected == nil {
		return errors.New("control is not present in the device description")
	}

	var value any
	if err := json.Unmarshal(rawValue, &value); err != nil {
		return fmt.Errorf("parse -value as JSON: %w", err)
	}

	// Standard outputs deliberately use standard Firmata commands. Only custom
	// callbacks use the rover-peripheral CONTROL operation, which is the central
	// distinction the probe is intended to validate on real hardware.
	switch selected.Output.Type {
	case "custom":
		return client.SendPeripheralControl(selected.ID, value)
	case "digital":
		enabled, ok := value.(bool)
		if !ok {
			return errors.New("digital control value must be true or false")
		}
		if selected.Output.ActiveLow {
			enabled = !enabled
		}
		if err := client.SetPinMode(byte(*selected.Output.Pin), roverd.FirmataPinModeOutput); err != nil {
			return err
		}
		return client.SetDigitalPin(byte(*selected.Output.Pin), enabled)
	case "pwm", "servo":
		number, ok := value.(float64)
		if !ok || number != float64(int(number)) {
			return errors.New("PWM and servo control values must be whole numbers")
		}
		mode := roverd.FirmataPinModePWM
		if selected.Output.Type == "servo" {
			mode = roverd.FirmataPinModeServo
		}
		if err := client.SetPinMode(byte(*selected.Output.Pin), mode); err != nil {
			return err
		}
		return client.ExtendedAnalog(byte(*selected.Output.Pin), int(number))
	default:
		return fmt.Errorf("unsupported output %q", selected.Output.Type)
	}
}
