package roverd

type RoverEvent struct {
	Type  string         `json:"type"`
	Event string         `json:"event"`
	Ts    int64          `json:"ts"`
	Data  map[string]any `json:"data,omitempty"`
}
