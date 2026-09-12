package roverd

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestHelloPeripheralMetadataContainsOnlyRenderableFields(t *testing.T) {
	minimum, maximum := 0, 180
	message := helloMessage{
		Type: "hello",
		Name: "test-rover",
		Peripherals: []RoverPeripheralMetadata{{
			ID:   "firmata-0",
			Name: "Camera arm",
			Controls: []RoverPeripheralControl{{
				ID: "position", Type: "slider", Name: "Position", Minimum: &minimum, Maximum: &maximum,
			}},
		}},
	}

	encoded, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal hello: %v", err)
	}
	text := string(encoded)
	if !strings.Contains(text, `"peripherals":[{"id":"firmata-0","name":"Camera arm","controls":[{"id":"position","type":"slider","name":"Position","min":0,"max":180}]`) {
		t.Fatalf("hello is missing ordered peripheral metadata: %s", text)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("unmarshal hello envelope: %v", err)
	}
	peripheralJSON := string(envelope["peripherals"])
	if strings.Contains(peripheralJSON, `"pin"`) || strings.Contains(peripheralJSON, `"output"`) {
		t.Fatalf("hello exposed private Firmata routing: %s", peripheralJSON)
	}
}

func TestInboundPeripheralCommandPreservesRawJSONValue(t *testing.T) {
	var message inboundMessage
	err := json.Unmarshal([]byte(`{
		"type":"peripheral",
		"id":"command-1",
		"peripheral":{"id":"firmata-0","control":"displayText","value":"hello rover"}
	}`), &message)
	if err != nil {
		t.Fatalf("unmarshal command: %v", err)
	}
	if message.Peripheral == nil || message.Peripheral.ID != "firmata-0" || message.Peripheral.Control != "displayText" {
		t.Fatalf("unexpected peripheral command: %#v", message.Peripheral)
	}
	if string(message.Peripheral.Value) != `"hello rover"` {
		t.Fatalf("raw value = %s", message.Peripheral.Value)
	}
}
