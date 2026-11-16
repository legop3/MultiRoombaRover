# Rover hardware configuration notes

This document records hardware-specific requirements while the roverd rework is in progress. The existing installer still contains machine-specific setup; the universal bootstrap and media profiles are not implemented yet. Final profile names and JSON examples will be added when those interfaces exist.

## Universal configuration requirements

- Audio capture and playback devices must be selectable on every supported architecture. An ARM machine need not use an AIY HAT, and an AMD64 machine need not use its first sound card.
- Keep the Google AIY Voice HAT as an explicit selectable profile, not a default applied to every Pi or every ARM binary.
- Prefer stable ALSA card identifiers over card numbers where supported; discover the actual identifier on the rover rather than assuming it from this document.
- Preserve concurrent TTS, horn, and forwarded audio playback and their independent volume controls. Device selection must cover these paths as well as the microphone streamer.
- Hardware-specific boot overlays, PWM pin allocation, and package setup belong to an explicit hardware choice or documented host setup. They must not be unconditional bootstrap side effects.

## Agreed audio routing design

Roverd configuration selects one physical input device and one physical output device. These may be on different sound cards. Roverd generates ALSA routing from those settings on startup, using the ordinary configuration save/restart flow when they change.

The microphone streamer uses the selected input. TTS, horn, and forwarded audio share the selected output while retaining simultaneous playback and separate volume controls. Profiles use the generated logical devices supplied through their environment; they do not each hardcode or independently select physical audio hardware. Use ALSA conversion where supported instead of requiring all devices to accept the existing HAT playback format.

AIY setup enables its hardware and uses this same routing system. The bootstrap still asks only for rover name and server address. This design is agreed but not yet implemented.

## Existing AIY Voice HAT setup

These facts come from the repository's existing installer/configuration, not a live hardware check:

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

## Remaining implementation work

- [ ] Add AIY capture/playback profiles alongside generic selectable ALSA device profiles.
- [ ] Make TTS, horn, forwarded audio, and mixer routing use configured devices consistently.
- [ ] Generate ALSA routing from the shared input/output configuration, including distinct input/output cards, logical profile devices, format conversion, and independent playback volume controls.
- [ ] Audit fixed card numbers, named PCM assumptions, capture formats, camera orientation/sensor defaults, serial device defaults, and architecture-specific TTS assets.
- [ ] Keep required one-time host boot changes visible; distinguish a hardware-overlay reboot from ordinary roverd update/restart behavior.
- [ ] Add exact final profile selections and JSON settings for the existing AIY rover.
- [ ] Verify on the actual HAT and at least one non-HAT audio device; record results rather than assuming compatibility.
