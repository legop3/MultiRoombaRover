package roverd

// Reports which transmit method each media stream is using, for the Rover Pi Stats card.
//
// Each publisher writes its transport to /run/roverd/<stream>-transport on startup and roverd
// reads it here. Best-effort throughout: a rover whose publishers have not started reports
// nothing, and every other host stat is unaffected.

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// defaultMediaStateDir holds the transport state files written by the publisher scripts. tmpfs
// is deliberate: this is live state about a running process, and it must not survive a reboot
// and then be reported as current.
const defaultMediaStateDir = "/run/roverd"

// mediaStateDir honours the same ROVERD_MEDIA_STATE_DIR override the publisher scripts accept.
// Reading it here is not optional: if only the scripts honoured it, pointing them elsewhere
// would leave roverd looking at an empty directory and silently reporting no transport, which
// looks identical to a publisher that never started.
func mediaStateDir() string {
	if dir := strings.TrimSpace(os.Getenv("ROVERD_MEDIA_STATE_DIR")); dir != "" {
		return dir
	}
	return defaultMediaStateDir
}

// Stream names, matching the file names the publisher scripts write.
const (
	mediaStreamVideo         = "video"
	mediaStreamAudioCapture  = "audio-capture"
	mediaStreamAudioPlayback = "audio-playback"
)

// MediaTransports reports the live transport for each stream. Fields are pointers so a stream
// whose publisher is not running is absent from the JSON rather than being reported as an
// empty transport, which the UI would have to distinguish from a genuine empty value.
type MediaTransports struct {
	Video         *MediaTransport `json:"video,omitempty"`
	AudioCapture  *MediaTransport `json:"audioCapture,omitempty"`
	AudioPlayback *MediaTransport `json:"audioPlayback,omitempty"`
}

type MediaTransport struct {
	// Active is what is carrying media right now: "rtsp", "whip" or "mpegts".
	Active string `json:"active,omitempty"`
}

// readMediaTransports loads whatever transport state exists. A missing directory is normal and
// not an error: it means no publisher has reported yet.
func readMediaTransports(dir string) *MediaTransports {
	video := readMediaTransport(dir, mediaStreamVideo)
	audioCapture := readMediaTransport(dir, mediaStreamAudioCapture)
	audioPlayback := readMediaTransport(dir, mediaStreamAudioPlayback)
	if video == nil && audioCapture == nil && audioPlayback == nil {
		return nil
	}
	return &MediaTransports{
		Video:         video,
		AudioCapture:  audioCapture,
		AudioPlayback: audioPlayback,
	}
}

func readMediaTransport(dir, stream string) *MediaTransport {
	file, err := os.Open(filepath.Join(dir, stream+"-transport"))
	if err != nil {
		return nil
	}
	defer file.Close()

	transport := MediaTransport{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		key, value, found := strings.Cut(strings.TrimSpace(scanner.Text()), "=")
		if found && key == "transport" {
			transport.Active = normalizeReportedTransport(value)
		}
	}
	if scanner.Err() != nil || transport.Active == "" {
		// No transport name means no information worth reporting, and a truncated read looks
		// the same, so both are treated as absent rather than as a half-populated row.
		return nil
	}
	return &transport
}

// normalizeReportedTransport collapses the aliases the scripts accept so the UI has one name
// per transport. "srt" and "mpegts" are the same wire path - MPEG-TS carried over SRT - and
// reporting both would imply a distinction that does not exist.
func normalizeReportedTransport(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "srt", "mpegts":
		return "mpegts"
	case "rtsp":
		return "rtsp"
	case "whip":
		return "whip"
	case "":
		return ""
	default:
		// Deliberately preserved rather than dropped: an unrecognised value means the
		// scripts and this reader have drifted, and showing it is how that gets noticed.
		return strings.ToLower(strings.TrimSpace(value))
	}
}
