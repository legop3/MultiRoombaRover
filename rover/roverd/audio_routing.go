package roverd

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const audioConfigPath = "/var/lib/roverd/asound.conf"

func validateAudioRouting(cfg AudioConfig) error {
	for name, value := range map[string]string{"inputDevice": cfg.InputDevice, "outputDevice": cfg.OutputDevice, "mixerCard": cfg.MixerCard} {
		if value == "" || strings.ContainsAny(value, "\x00\r\n") {
			return fmt.Errorf("audio.%s must be a nonempty single-line ALSA identifier", name)
		}
	}
	return nil
}

// Generate a private ALSA configuration inherited by all roverd children. Do
// not overwrite the host's /etc/asound.conf or impose the AIY card on other hosts.
func AudioConfiguration(cfg AudioConfig) string {
	text := "</usr/share/alsa/alsa.conf>\n"
	text += fmt.Sprintf(`pcm.rover_capture { type plug slave.pcm %s }
pcm.rover_mix {
 type dmix
 ipc_key 70601
 ipc_key_add_uid true
 # Preserve the previous mixer's explicit ALSA buffer geometry.
 slave {
  pcm %s format S16_LE rate %d channels %d
  period_time 0
  period_size 1024
  buffer_size 4096
 }
}
`, strconv.Quote(cfg.InputDevice), strconv.Quote(cfg.OutputDevice), cfg.OutputSampleRate, cfg.OutputChannels)
	for _, pair := range [][2]string{{"tts", "TTSMaster"}, {"horn", "HornMaster"}, {"forward", "ForwardMaster"}} {
		text += fmt.Sprintf(`pcm.rover_%s_volume {
 type softvol
 slave.pcm "rover_mix"
 control { name %s card %s }
 min_dB -60.0
 max_dB 12.0
}
pcm.rover_%s { type plug slave.pcm "rover_%s_volume" }
`, pair[0], strconv.Quote(pair[1]), strconv.Quote(cfg.MixerCard), pair[0], pair[0])
	}
	text += fmt.Sprintf(`pcm.!default { type asym playback.pcm "rover_tts" capture.pcm "rover_capture" }
ctl.!default { type hw card %s }
`, strconv.Quote(cfg.MixerCard))
	return text
}

func ConfigureAudio(cfg AudioConfig) error {
	text := AudioConfiguration(cfg)
	if err := os.MkdirAll(filepath.Dir(audioConfigPath), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(audioConfigPath, []byte(text), 0600); err != nil {
		return err
	}
	return os.Setenv("ALSA_CONFIG_PATH", audioConfigPath)
}
