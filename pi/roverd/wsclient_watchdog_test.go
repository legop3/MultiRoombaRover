package roverd

import "testing"

func TestSensorWatchdogConsoleEpisodeSuppressesDuplicateStatusMessages(t *testing.T) {
	client := &WSClient{}

	if !client.openSensorWatchdogEpisode() {
		t.Fatal("first recovery attempt should announce the watchdog episode")
	}
	if client.openSensorWatchdogEpisode() {
		t.Fatal("repeated recovery attempt should not repeat the outage announcement")
	}
	if !client.markSensorWatchdogCommandsOK() {
		t.Fatal("first successful command restart should be announced")
	}
	if client.markSensorWatchdogCommandsOK() {
		t.Fatal("repeated successful command restart should not be announced")
	}

	// Receiving a real frame closes the outage. A later silence is a distinct
	// incident and must therefore be visible on the console again.
	client.closeSensorWatchdogEpisode()
	if !client.openSensorWatchdogEpisode() {
		t.Fatal("new outage after a sensor frame should be announced")
	}
}
