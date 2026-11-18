# Writing rover media profiles

Bundled profiles live in `rover/profiles/video.yaml`, `audioCapture.yaml`, and `audioPlayback.yaml`. Each catalog is a YAML list with these fields:

- `id`: lowercase letters, digits, underscores, or hyphens; `custom` is reserved.
- `name` and `description`: displayed in Fleet Management.
- `setup`: optional Bash command, safe to repeat at every roverd startup.
- `run`: Bash command that stays running to stream media.

Put commands directly in YAML, not in repository shell helpers. Bash arrays and pipelines work. Commands run as root with error and pipeline failure handling, in `/var/lib/roverd/profiles/<category>/<id>`. That directory persists across restarts and updates.

Enabled profiles run setup serially, then stream independently. Setup failure stops only that streamer. Exited run commands retry after two seconds without repeating setup. Shutdown stops the complete process group. Output and status appear in Fleet Management; output buffering is bounded.

## Command variables

Variables are supplied through the environment. Quote expansions normally, for example `"$ROVER_AUDIO_INPUT_DEVICE"`.

| Variables | Meaning |
| --- | --- |
| `ROVER_NAME`, `ROVER_SERVER_HOST` | Identity and server hostname |
| `ROVER_PROFILE_DIR`, `ROVER_REPO_DIR` | Persistent working directory and checkout |
| `ROVER_VIDEO_PUBLISH_URL`, `ROVER_AUDIO_PUBLISH_URL`, `ROVER_AUDIO_PLAYBACK_URL` | Complete derived RTSP URLs |
| `ROVER_AUDIO_INPUT_DEVICE`, `ROVER_AUDIO_OUTPUT_DEVICE` | Generated logical ALSA microphone and forwarded-audio routes |


Fleet Management supports one custom profile per category, saved at `/etc/roverd/profiles/<category>.yaml`. The selected setup/run commands are visible. Copy to custom lets you edit them; Save and use custom saves the configuration and selects the custom command in one restart. Camera and encoder options belong in these commands, not generic config fields.

## Audio constraints

Use the supplied logical audio routes so microphone, TTS, horn, and forwarded audio follow the configured devices. Physical input/output are selected separately through `audio.inputDevice` and `audio.outputDevice`. Find stable identifiers with `arecord -l` and `aplay -l`.

The output must support a hardware dmix slave with the configured sample rate/channels. Client format conversion uses ALSA plug devices. Independent volume controls may appear only after their PCM first opens. ARMv6 hosts use flite/espeak rather than Chrome TTS.

For the existing AIY Voice HAT, verify card ID `sndrpigooglevoi` before using `hw:CARD=sndrpigooglevoi,DEV=0`; the previous output format was 16000 Hz mono. GPIO18/19 are used by I2S. The existing GPIO12 servo requires `dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4` in an applicable boot-config section. Reboot after overlay changes.

## Verification still required

Implementation has passed local build/syntax checks; live deployment remains unverified:

- Bootstrap, configuration saves, fleet field changes, and update results after reconnection.
- Camera, microphone, simultaneous TTS/horn/forwarded audio, individual gains, and GPIO/serial operation.
- Streamer retries on a brief connection loss and complete child shutdown on config restart. The separate control watchdog reboots after six minutes offline.

Before replacing an old installation, disable its streamer services and remove its roverd-specific host ALSA definitions; system ALSA hooks can still load those definitions.
