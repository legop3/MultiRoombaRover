# Rover media profiles and audio

Roverd reads three YAML catalogs directly from its checkout: `rover/profiles/video.yaml`, `audioCapture.yaml`, and `audioPlayback.yaml`. Each is a list of profiles with `id`, `name`, `description`, optional `setup`, and `run`.

Commands live in the YAML itself. Bundled profiles must not delegate their setup or run implementation to an in-repository shell helper. Multiline shell commands, arrays, and pipelines are supported through Bash with error/pipe failure handling. Profile identifiers use lowercase letters, digits, underscores, and hyphens; `custom` is reserved.

Each enabled streamer runs its selected setup on every daemon startup. Setups are serialized to avoid competing package-manager operations; successful setup is not tracked on disk. Each run command then starts independently and retries after two seconds on exit. A failed setup leaves only that streamer stopped. Shutdown kills the complete process group and waits for it. Nothing installs media systemd services.

Working directories are `/var/lib/roverd/profiles/<category>/<id>`. Commands receive environment variables, not interpolated shell source. Quote variables normally.

| Variables | Meaning |
| --- | --- |
| `ROVER_NAME`, `ROVER_SERVER_HOST` | Identity and server hostname |
| `ROVER_PROFILE_DIR`, `ROVER_REPO_DIR` | Persistent working directory and checkout |
| `ROVER_VIDEO_DEVICE`, `ROVER_VIDEO_INPUT_FORMAT` | Camera input |
| `ROVER_VIDEO_WIDTH`, `ROVER_VIDEO_HEIGHT`, `ROVER_VIDEO_FPS`, `ROVER_VIDEO_BITRATE` | Camera/encoder settings |
| `ROVER_VIDEO_INVERTED`, `ROVER_VIDEO_SENSOR_MODE` | Orientation and optional rpicam mode |
| `ROVER_VIDEO_PUBLISH_URL`, `ROVER_AUDIO_PUBLISH_URL`, `ROVER_AUDIO_PLAYBACK_URL` | Complete derived RTSP URLs |
| `ROVER_AUDIO_INPUT_DEVICE`, `ROVER_AUDIO_OUTPUT_DEVICE` | Generated logical ALSA microphone and forwarded-audio routes |
| `ROVER_AUDIO_SAMPLE_RATE`, `ROVER_AUDIO_CHANNELS`, `ROVER_AUDIO_BITRATE` | Microphone encoding settings |
| `ROVER_AUDIO_NORMALIZE`, `ROVER_AUDIO_NORMALIZE_FILTER` | Forwarded-audio normalization |

The bundled options are `v4l2` / `rpicam` for video and `alsa` / `aiy` for capture and playback. Hardware encoders or other transports can be supplied as custom commands without adding roverd code.

## Configuration and UI

Select `media.video.profile`, `media.audioCapture.profile`, and `media.audioPlayback.profile`, with each category's `enabled` switch. Fleet management renders profile names from the catalogs and has a “Media profiles and output” section for descriptions, current status, output, and custom editing.

There is one custom profile per category, stored under `/etc/roverd/profiles/<category>.yaml`. Saving it restarts roverd; select `custom` in configuration to use it. Bundled files remain in the checkout. The admin API is `roverManagement:saveProfile` with `{ roverId, category, profile }`.

Output is always forwarded while management is connected, without viewer subscriptions. Rover queues and server/browser history are bounded; a noisy process can lose old output but cannot indefinitely block streaming or grow history. Current streamer status is retained separately and included in management hello.

## Audio routing

`audio.inputDevice` and `audio.outputDevice` select physical ALSA devices independently. Use hardware PCM identifiers such as `hw:CARD=Device,DEV=0`; find the actual identifiers with `arecord -l` and `aplay -l`. The output must support ALSA dmix's hardware slave; arbitrary sound-server/plugin PCM names are not interchangeable with a hardware PCM.

`audio.mixerCard` selects the output card's mixer identifier. `audio.outputSampleRate` and `audio.outputChannels` configure its hardware mix format. Choose a format supported by that device; `plug` handles client conversion to that format. Input and output may be on separate cards.

Roverd generates `/var/lib/roverd/asound.conf` and sets `ALSA_CONFIG_PATH` for its children. It does not overwrite the host's ALSA configuration. Its system ALSA include can still load host configuration through ALSA hooks; remove old roverd-specific host ALSA definitions before deployment. Logical devices are `rover_capture`, `rover_tts`, `rover_horn`, and `rover_forward`. TTS, horn, and forwarded audio share a dmix output and have independent soft-volume controls. `amixer` targets the configured mixer card, never a fallback card zero. Some soft-volume controls appear only once their PCM has first been opened; verify volume behavior after playback begins.

Chrome TTS uses the same generated playback route. Its architecture-specific library/voice files are runtime data under `/var/lib/roverd/googletts`; the installer invokes the independent TTS dependency installer. ARMv6 hosts must use flite/espeak if no matching Chrome library is available. The server no longer substitutes Chrome TTS when a command omits an engine; roverd's configured default applies.

## Inspection without hardware or setup execution

```sh
./dist/roverd-linux-amd64 -repo "$PWD" -print-media-profiles
./dist/roverd-linux-amd64 -config rover/roverd/roverd.sample.json -check-config
./dist/roverd-linux-amd64 -config rover/roverd/roverd.sample.json -print-audio-config
```

These commands do not install packages, open devices, or start streams. Configuration/schema and architecture binaries have changed together; old JSON objects are not migrated.

## Deployment checks still required

Before deploying over an old installation, explicitly disable/remove its old media units so they cannot compete for devices or publish duplicate streams. This rework does not migrate an installed host. The checkout installer now installs only the roverd service and runtime dependencies; standalone bootstrap/update redesign remains a later stage.

On the actual rover, confirm all selected profiles complete setup, observe output/status in fleet management, and verify video, microphone, forwarded audio, TTS, horn, simultaneous playback, and each gain control. Restart the server or interrupt Wi-Fi: media commands should retry without restarting roverd. Save configuration and verify no media child processes remain from the previous daemon. Capture journal output and observed results. AIY overlay changes require a one-time host reboot; ordinary configuration saves only restart roverd.
