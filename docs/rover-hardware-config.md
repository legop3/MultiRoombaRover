# Rover hardware configuration notes

This document records hardware-specific requirements while the roverd rework is in progress. Media profiles and shared audio routing are implemented. The standalone bootstrap creates the managed checkout and invokes the shared installer. Configuration selections are recorded below.

## Universal configuration requirements

- Audio capture and playback devices must be selectable on every supported architecture. An ARM machine need not use an AIY HAT, and an AMD64 machine need not use its first sound card.
- Keep the Google AIY Voice HAT as an explicit selectable profile, not a default applied to every Pi or every ARM binary.
- Prefer stable ALSA card identifiers over card numbers where supported; discover the actual identifier on the rover rather than assuming it from this document.
- Preserve concurrent TTS, horn, and forwarded audio playback and their independent volume controls. Device selection must cover these paths as well as the microphone streamer.
- Hardware-specific boot overlays, PWM pin allocation, and package setup belong to an explicit hardware choice or documented host setup. They must not be unconditional bootstrap side effects.

## Agreed audio routing design

Roverd configuration selects one physical input device and one physical output device. These may be on different sound cards. Roverd generates ALSA routing from those settings on startup, using the ordinary configuration save/restart flow when they change.

The microphone streamer uses the selected input. TTS, horn, and forwarded audio share the selected output while retaining simultaneous playback and separate volume controls. Profiles use the generated logical devices supplied through their environment; they do not each hardcode or independently select physical audio hardware. Use ALSA conversion where supported instead of requiring all devices to accept the existing HAT playback format.

AIY setup enables its hardware and uses this same routing system. The bootstrap still asks only for rover name and server address. Audio routing and the standalone bootstrap are implemented; hardware verification remains pending.

## Historical AIY Voice HAT setup

These facts record the previous installer/configuration, not a live hardware check or the current implementation:

- The Pi installer enables `dtoverlay=googlevoicehat-soundcard` and `dtparam=i2s=on`, and disables onboard audio with `dtparam=audio=off`.
- The README records that this setup worked on Raspberry Pi OS Bookworm and had problems on Trixie. The rework must not imply that the HAT is verified on every Debian release.
- The current ALSA routing uses `hw:0,0` and mixer card `0`. A comment identifies the HAT card as `sndrpigooglevoi`; verify the actual card identifier on the deployed rover before replacing numeric device references.
- Logical playback devices are `tts`, `horn`, and `forward`; capture has the `rovermic` alias. They share a playback mixer configured for 16 kHz mono S16_LE and expose `TTSMaster`, `HornMaster`, and `ForwardMaster` volume controls.
- The existing source places a kernel-module `options` line in `asound.conf`. During audio-profile implementation, separate module configuration from ALSA PCM configuration instead of copying that assumption into the generic setup.
- The installer enables PWM on GPIO12/13 with `dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4`, explicitly leaving GPIO18/19 free for I2S. The sample servo uses GPIO12, while the checked-in local config has a disabled servo on GPIO19. Do not enable that saved GPIO19 servo setting for the HAT setup without checking wiring and I2S ownership.

For the new internal GPIO peripheral, enable `piGpio.enabled` on a rover that uses these GPIO features, then configure its children for the actual wiring:

| Feature | Existing setup to preserve |
| --- | --- |
| BRC | Enabled, GPIO4 on `gpiochip0`, pulse every 1 minute for 1 second |
| Headlight | Enabled, GPIO22 on `gpiochip0`, active-low, initially off |
| Laser | Optional, GPIO27 on `gpiochip0`, active-high, initially off |
| Camera servo | Optional; sample GPIO12, 50 Hz, cycle length 20000, 900–2100 microseconds, -15 to 30 degrees, home 0, nudge 2 degrees |

The parent switch now defaults to disabled. Saved child settings do not enable GPIO on their own. External peripherals must not advertise the same enabled role unless the conflicting internal role is disabled.

## Implementation and verification tracking

- [x] Add AIY capture/playback profiles alongside generic selectable ALSA device profiles.
- [x] Make TTS, horn, forwarded audio, and mixer routing use configured devices consistently.
- [x] Generate ALSA routing from the shared input/output configuration, including distinct input/output cards, logical profile devices, format conversion, and independent playback volume controls.
- [x] Audit fixed card numbers, named PCM assumptions, capture formats, camera orientation/sensor defaults, serial device defaults, and architecture-specific TTS assets. Findings and deployment checks are below.
- [x] Keep required one-time host boot changes visible; distinguish a hardware-overlay reboot from ordinary roverd update/restart behavior.
- [x] Add exact final profile selections and JSON settings for the existing AIY rover.
- [ ] Verify on the actual HAT and at least one non-HAT audio device; record results rather than assuming compatibility.

## Implemented profile/audio selections (2026-11-16)

The new supervisor and generated ALSA routing are implemented, but not hardware-verified. See [media profile documentation](rover-media-profiles.md). Bundled setup/run commands are contained in YAML, not repository shell helpers.

For the existing AIY v1 setup, start with these fields in a complete current config:

- `media.video.profile`: `rpicam`, enabled for the CSI camera; retain the existing resolution/bitrate, inverted mounting, and sensor mode if appropriate.
- `media.audioCapture.profile` and `media.audioPlayback.profile`: `aiy`, enabling each required streamer. Their inline setup enables I2S and the Google Voice HAT overlay. Reboot once if setup changes boot configuration.
- `audio.inputDevice` and `audio.outputDevice`: `hw:CARD=sndrpigooglevoi,DEV=0`, **after verifying that identifier on the rover**.
- `audio.mixerCard`: `sndrpigooglevoi`, matching the verified output card.
- `audio.outputSampleRate`: `16000`; `audio.outputChannels`: `1`, preserving the old HAT mixing format.
- `audio.ttsEnabled`: true if desired; choose `audio.defaultEngine` explicitly. Chrome speech assets now live outside the checkout under `/var/lib/roverd/googletts`.
- Enable the parent `piGpio.enabled` and the desired child roles as described above. The old automatic PWM-overlay installer is gone; the GPIO12/13 PWM overlay remains a documented host wiring requirement, not an audio-profile side effect.

The HAT setup does not disable unrelated onboard audio or force a card index. Use the configured stable device/card names. Existing installed media systemd units must be removed/disabled before running the new supervisor. Remove any old roverd-specific host ALSA configuration before deployment: the generated config includes the system ALSA definitions, whose hooks can still load host configuration. The old media launchers are no longer used.


## Hardware assumption audit (2026-11-16)

- New configs use a non-inverted camera and automatic CSI sensor mode (empty `media.video.sensorMode`). The AIY/CSI sample and checked-in rover config retain the existing inverted mount and `1296:972` selection. For your existing rover set `media.video.inverted` to true and retain that sensor mode only if supported by the connected camera. V4L2 uses `media.video.device` and `inputFormat`; its profile ignores the CSI mode.
- `serial.device` defaults to `/dev/ttyUSB0`, but accepts a stable `/dev/serial/by-id/...` path. Select the Roomba adapter explicitly to avoid depending on USB enumeration. Peripheral discovery excludes that device.
- Audio card zero and 48 kHz stereo are editable defaults, not mandatory hardware. Set the physical input/output separately and use the HAT's 16 kHz mono output values above. Logical plug devices perform format conversion; the physical output still needs to support the chosen dmix format. Verify microphone channels/rate against actual hardware.
- Chrome TTS assets are chosen by installed OS architecture; ARMv6 has no bundled Chrome library and should use `audio.defaultEngine: "flite"` or `"espeak"`. Chrome libraries/voices still require on-device verification. TTS, horn, and forwarded audio use the generated routing; verify independent gains after each logical PCM has opened, when ALSA creates its soft-volume control.
- Pi firmware voltage/throttle probes run only when `vcgencmd` is installed. Native GPIO access remains controlled by `piGpio.enabled`, independently of host-health telemetry.
- AIY profile setup adds new boot settings under `[all]`. If existing matching settings are inside a model-specific section, ensure that section applies to your Pi. The profile does not rewrite existing host sections.
- Keep `dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4` in an applicable boot-config section for the existing GPIO12 servo wiring. Keep GPIO18/19 free for the HAT's I2S. Reboot after overlay changes.

No camera, ALSA device, firmware command, or GPIO operation was exercised during this source audit. Host installation, browser flows, and physical hardware verification remain required.
