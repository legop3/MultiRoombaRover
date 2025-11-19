# Video flow (SRT ingest, WHEP playback)

1. **Raspberry Pi Zero 2 W**
   - `pi/bin/video-publisher.sh` captures the CSI camera with `rpicam-vid`/`libcamera-vid` using the onboard H.264 encoder (`--inline --profile baseline --bitrate …`).
   - The Annex-B stream is piped into the stock FFmpeg package and pushed to the control server over SRT as MPEG‑TS: `ffmpeg -f h264 -i - -c copy -f mpegts "srt://<server>:9000?streamid=#!::r=rover-alpha,m=publish&latency=20&mode=caller&transtype=live&pkt_size=1316"`.
   - Configuration lives in `/var/lib/roverd/video.env` (`PUBLISH_URL`, resolution, FPS, bitrate). `roverd` rewrites this file whenever the rover config changes, so onboarding a new rover is just flashing the SD card, setting its `name`, and plugging it into the trusted LAN—**no auth or per-rover server config is required on the Pi ⇄ server hop.**

2. **mediaMTX on the server**
   - Single wildcard path handles every rover:
     ```yaml
     paths:
       "~^rover-(?P<id>[a-z0-9_-]+)$":
         source: publisher
         sourceOnDemand: no
         sourceProtocol: srt
         readBufferCount: 512
         webrtcEnable: yes
         webrtcMaxPlayoutDelay: 0
         alwaysRemuxWhep: no
     ```
   - Pis publish to `srt://<server>:9000` with the streamid above; mediaMTX auto-creates the path and fans it out over WHEP/WebRTC. If you expose playback under `/video/<id>` externally, let the reverse proxy rewrite that prefix back to `<id>` before forwarding to mediaMTX so the wildcard continues to match every rover.
   - Only playback is gated: mediaMTX calls the Node server to validate JWTs on `/whep/rover-<id>`, so “locking” a stream is as simple as refusing to mint viewer tokens for that rover. Ingest stays unauthenticated because it lives on a secure LAN.

3. **Web clients**
   - Tiny helper (React hook or vanilla class) that:
     1. Requests a viewer token for rover `<id>`.
     2. Issues a `POST` to `<mediamtx-host>/<rover-id>/whep` with `Authorization: Basic base64(token:token)` (token issued by the server when the client calls `video:request`).
     3. Maintains auto-reconnect timers on ICE failure so dashboard widgets can come/go without reloading the page.
   - Operator dashboard mounts one player tied to the assigned rover. The spectator view instantiates one player per tile, muting + pausing hidden elements to keep CPU usage sane even when every rover is shown simultaneously.

# Deployment checklist

- `pi/install_roverd.sh` installs the `video-publisher` helper, drops `/var/lib/roverd/video.env`, and pulls in `libcamera-apps` + `ffmpeg` from apt. No custom FFmpeg, no WHIP builds, no extra config—Pis become plug-and-play.
- `roverd` derives `media.publishUrl` automatically from `serverUrl`: `srt://<server>:9000?streamid=#!::r=<name>,m=publish&latency=20&mode=caller&transtype=live&pkt_size=1316`. The media supervisor rewrites `video.env` and manages `video-publisher.service` whenever you hit “Restart Camera” or change `/etc/roverd.yaml`.
- The server’s mediaMTX config switches to the wildcard block above, leaves SRT ingest open, and enforces JWTs only on WHEP viewers. Fan-out stays inside mediaMTX so every browser sees the same low-latency stream (≈250–350 ms glass-to-glass).
- Adding a rover = flash SD → set `/etc/roverd.yaml` (`name`, `serverUrl`, camera knobs if needed) → boot it. The server auto-discovers the new `rover-<id>` stream with zero manual edits.
