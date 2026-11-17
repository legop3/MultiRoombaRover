package roverd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/invopop/jsonschema"
	validator "github.com/santhosh-tekuri/jsonschema/v6"
)

func (Duration) JSONSchema() *jsonschema.Schema {
	return &jsonschema.Schema{Type: "string", Description: "Duration, for example 250ms, 1s, or 1m."}
}

var configurationSchema = sync.OnceValues(func() (json.RawMessage, *validator.Schema) {
	r := jsonschema.Reflector{Anonymous: true, DoNotReference: true}
	schema := r.Reflect(&Config{})
	// The existing React form validator uses draft 7. This schema contains no
	// references or newer keywords, so both ends use the same simple dialect.
	schema.Version = "http://json-schema.org/draft-07/schema#"
	schema.Title = "Rover configuration"
	data, err := json.Marshal(schema)
	if err != nil {
		panic(err)
	}
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		panic(err)
	}
	compiler := validator.NewCompiler()
	const location = "urn:roverd:configuration"
	if err := compiler.AddResource(location, document); err != nil {
		panic(err)
	}
	compiled, err := compiler.Compile(location)
	if err != nil {
		panic(err)
	}
	return data, compiled
})

func ConfigurationSchema() json.RawMessage {
	data, _ := configurationSchema()
	return data
}

func ValidateConfigurationSchema(data []byte) error {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	_, schema := configurationSchema()
	return schema.Validate(value)
}

// SaveConfig replaces one complete object, never merging or keeping revisions.
// A temporary file on the same filesystem prevents partial JSON after a crash.
func SaveConfig(path string, cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".roverd-config-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(append(data, '\n')); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("replace configuration: %w", err)
	}
	return nil
}
