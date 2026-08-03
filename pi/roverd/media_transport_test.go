package roverd

// Pins transport reporting. The cases that matter are the absent ones: a rover whose publishers
// have not started must report no transport rather than a wrong one, and must not disturb any
// other host stat.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeStateFile(t *testing.T, dir, stream, body string) {
	t.Helper()
	path := filepath.Join(dir, stream+"-transport")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestReadMediaTransportsMissingDirectoryReportsNothing(t *testing.T) {
	if got := readMediaTransports(filepath.Join(t.TempDir(), "absent")); got != nil {
		t.Fatalf("expected nil for a missing state directory, got %+v", got)
	}
}

func TestReadMediaTransportsEmptyDirectoryReportsNothing(t *testing.T) {
	if got := readMediaTransports(t.TempDir()); got != nil {
		t.Fatalf("expected nil when no publisher has written state, got %+v", got)
	}
}

func TestReadMediaTransportsReadsAllThreeStreams(t *testing.T) {
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "transport=rtsp\n")
	writeStateFile(t, dir, "audio-capture", "transport=mpegts\n")
	writeStateFile(t, dir, "audio-playback", "transport=whip\n")

	got := readMediaTransports(dir)
	if got == nil {
		t.Fatal("expected transports, got nil")
	}
	if got.Video == nil || got.Video.Active != "rtsp" {
		t.Errorf("video: %+v", got.Video)
	}
	if got.AudioCapture == nil || got.AudioCapture.Active != "mpegts" {
		t.Errorf("audioCapture: %+v", got.AudioCapture)
	}
	if got.AudioPlayback == nil || got.AudioPlayback.Active != "whip" {
		t.Errorf("audioPlayback: %+v", got.AudioPlayback)
	}
}

func TestReadMediaTransportsPartialStateReportsOnlyWhatExists(t *testing.T) {
	// Video publishing while audio is not is ordinary, and must not suppress the stream that
	// did report.
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "transport=rtsp\n")

	got := readMediaTransports(dir)
	if got == nil || got.Video == nil {
		t.Fatalf("expected video, got %+v", got)
	}
	if got.AudioCapture != nil || got.AudioPlayback != nil {
		t.Fatalf("expected absent audio streams, got capture=%+v playback=%+v", got.AudioCapture, got.AudioPlayback)
	}
}

func TestReadMediaTransportSrtNormalisesToMpegts(t *testing.T) {
	// srt and mpegts are the same wire path, so reporting both would imply a distinction that
	// does not exist.
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "transport=srt\n")

	got := readMediaTransports(dir)
	if got == nil || got.Video == nil || got.Video.Active != "mpegts" {
		t.Fatalf("expected srt to normalise to mpegts, got %+v", got.Video)
	}
}

func TestReadMediaTransportRecordWithoutTransportIsAbsent(t *testing.T) {
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "somethingElse=1\n")

	if got := readMediaTransports(dir); got != nil {
		t.Fatalf("expected nil for a record with no transport name, got %+v", got)
	}
}

func TestReadMediaTransportToleratesJunk(t *testing.T) {
	// Blank lines, comments and unknown keys must not prevent the transport being read.
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "\n# a comment\ntransport=rtsp\nsomethingNew=42\nnot a pair\n")

	got := readMediaTransports(dir)
	if got == nil || got.Video == nil || got.Video.Active != "rtsp" {
		t.Fatalf("expected rtsp, got %+v", got.Video)
	}
}

func TestReadMediaTransportPreservesUnknownTransportName(t *testing.T) {
	// If the scripts and this reader ever drift, showing the unrecognised name is how that gets
	// noticed. Silently dropping it would hide the drift.
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "transport=quic-someday\n")

	got := readMediaTransports(dir)
	if got == nil || got.Video == nil || got.Video.Active != "quic-someday" {
		t.Fatalf("expected the unknown name preserved, got %+v", got.Video)
	}
}

func TestMediaStateDirHonoursTheSameOverrideAsTheScripts(t *testing.T) {
	// The publisher scripts accept ROVERD_MEDIA_STATE_DIR. If roverd ignored it, overriding it
	// would leave roverd reading an empty directory and reporting nothing, which looks identical
	// to a publisher that never started.
	if got := mediaStateDir(); got != defaultMediaStateDir {
		t.Fatalf("expected the default with no override, got %q", got)
	}
	t.Setenv("ROVERD_MEDIA_STATE_DIR", "/tmp/somewhere-else")
	if got := mediaStateDir(); got != "/tmp/somewhere-else" {
		t.Fatalf("expected the override to be honoured, got %q", got)
	}
	t.Setenv("ROVERD_MEDIA_STATE_DIR", "   ")
	if got := mediaStateDir(); got != defaultMediaStateDir {
		t.Fatalf("expected a blank override to fall back to the default, got %q", got)
	}
}

func TestHostStatsMediaWireFormat(t *testing.T) {
	// Pins the JSON the browser reads. PiHostStatsCard indexes stats.media.video.active by that
	// exact name, so a rename silently blanks the card rather than failing anything - this test
	// is what turns that into a build failure.
	dir := t.TempDir()
	writeStateFile(t, dir, "video", "transport=rtsp\n")

	encoded, err := json.Marshal(HostStats{Media: readMediaTransports(dir)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(encoded)
	for _, want := range []string{`"media"`, `"video"`, `"active":"rtsp"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected %s in %s", want, got)
		}
	}
}

func TestHostStatsOmitsMediaWhenAbsent(t *testing.T) {
	// A rover with no transport state must not send a media key at all, so the card falls back
	// to "--" instead of rendering an empty object as though a publisher had reported.
	encoded, err := json.Marshal(HostStats{Media: readMediaTransports(filepath.Join(t.TempDir(), "absent"))})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), "media") {
		t.Fatalf("expected no media key, got %s", encoded)
	}
}
