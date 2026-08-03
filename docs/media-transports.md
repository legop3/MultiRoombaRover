# Media transports

How rover video and audio get to and from the media server, what the default is, and the one
knob that changes it.

Full measurements and method are in [webrtc/README.md](../webrtc/README.md). This document is the
operator's view.

---

## ⚠️ READ THIS FIRST: `rtsp: yes` is now REQUIRED on the media server

**There is no automatic fallback between transports. If RTSP is not enabled on the media server,
rovers on the default transport will not publish at all — no video, no microphone, no speaker.**

Enable it in the media server config before deploying:

```yaml
# server/mediamtx/mediamtx.yml
rtsp: yes
rtspAddress: <lan-ip>:8554
rtpAddress: <lan-ip>:8000     # rtspAddress governs only the TCP control port
rtcpAddress: <lan-ip>:8001    # the UDP RTP/RTCP listeners are separate
```

The version in this repo already has it. A hand-maintained config on a live server may not.

### Why there is no fallback

An earlier version of this work probed ffmpeg's capabilities, ranked the transports, and demoted to
MPEG-TS after three consecutive failures. That was removed deliberately, and it is worth
understanding the trade rather than treating it as an oversight:

- **A rover silently running on the slow path is harder to notice than one that is visibly down.**
  Automatic demotion meant a broken RTSP endpoint produced a working rover with the latency win
  quietly gone — the exact failure that goes unnoticed for weeks.
- The cascade was ~400 lines of probing, counters and state across three scripts, the Go config,
  and the UI, to paper over a one-line server setting.

So the behaviour is now: **the publisher uses the transport it was configured with, and systemd
restarts it if the pipeline exits.** A misconfiguration is loud.

### If you cannot enable RTSP

Set the old transport explicitly, per path. This is the deliberate fallback and it is exact — it
restores precisely the previous behaviour:

```yaml
media:
  video:
    transport: mpegts
  audioCapture:
    transport: mpegts
  audioPlayback:
    transport: mpegts
```

---

## The short version

**You configure nothing.** Every stream URL is derived from the server host plus the rover's
`name`, and the default transport is **RTSP over TCP**, which measured **39ms** glass-to-glass
against **199–235ms** for the previous MPEG-TS/SRT setup.

RTSP is the default because it is the fastest transport every current rover can actually run, and
because deriving the URL means it needs no per-rover setup.

To go back to the old behaviour, set one field:

```yaml
media:
  video:
    transport: mpegts    # or "srt", same thing
```

That knob exists on all three media blocks independently, so you can move one path and leave the
others alone.

## Which transport is best

| transport | video p50 | works on | verdict |
|---|---|---|---|
| **WHIP** | **27ms** | ffmpeg ≥ 7.1 only | best, but Pi OS bookworm ships 5.1 |
| **RTSP / TCP** | **39ms** | ffmpeg 4.x+ | **the practical default** |
| MPEG-TS / SRT | 199–235ms | anything | the old path, kept as fallback |
| RTSP / UDP | — | — | **broken across the internet, never use** |

WHIP is both faster and steadier (26/27/29ms across repeats, against 66/39/39 for RTSP/TCP). It is
not the default only because the muxer needs ffmpeg ≥ 7.1 and Pi OS bookworm ships 5.1. On a rover
with a newer ffmpeg, set `transport: whip`.

**RTSP must be TCP.** Plain RTP/UDP has no retransmission where the SRT it replaces has ARQ, so
RTSP/UDP is strictly worse than what it replaces and fails outright over the internet — the
stream publishes, the path goes ready, and no viewer ever starts. The publisher pins TCP. If
head-of-line blocking on a bad radio ever becomes the problem, the answer is WHIP, not UDP.

## Where the latency was

All of it was **MediaMTX's MPEG-TS demux, ~115–160ms per leg**. Not SRT, not the encoder, not the
browser. It sits inside the server, which is why no encoder flag on the rover ever helped. Every
transport here that avoids MPEG-TS avoids that cost.

## The three audio paths are not the same thing

These get confused constantly. They are three separate streams, in two different directions, and
only two of them involve the rover at all.

### 1. Rover microphone → viewers

The rover's mic, so viewers can hear the room.

```
rover mic → audio-only-publisher.sh → [server: <rover>-audio] → WHEP → viewer browsers
```

- Rover **publishes**. Config block: `media.audioCapture`.
- Transports: `whip`, `rtsp`, `mpegts`.
- Measured **330ms → 183.7ms**.
- Script: [pi/bin/audio-only-publisher.sh](../pi/bin/audio-only-publisher.sh)

### 2. Server → rover speaker

Audio the **server** produces — TTS, `rs bonk`, a VIP upload, or a driver's forwarded mic — played
out of the rover's own speaker.

```
server (audioForwardService) → [server: <rover>-fwd] → audio-forward-listener.sh → rover speaker
```

- Rover **reads**. Config block: `media.audioPlayback`.
- Transports: `rtsp`, `mpegts`. **No WHIP** — the rover is a reader here and WHIP is a publish
  protocol; the read-side equivalent is WHEP, which ffmpeg cannot consume.
- Measured **283ms → 30.5ms**. It improved most because it was the only path paying the MPEG-TS
  cost on *both* legs.
- Script: [pi/bin/audio-forward-listener.sh](../pi/bin/audio-forward-listener.sh)

### 3. Driver's browser → rover speaker (push-to-talk)

A driver talking through the rover. **This one does not touch roverd's config at all.**

```
driver browser mic → WHIP → [server: <rover>-fwd] → (path 2 above delivers it)
```

- The **browser** publishes over WHIP; it always has. There is no rover-side transport setting for
  it, because the rover only sees the result via path 2.
- Measured **138ms → 29.7ms**, and that gain came entirely from fixing path 2's read leg.
- Client: [webui/src/components/vip/VipAudioUploadCard/](../webui/src/components/vip/VipAudioUploadCard/)

So paths 2 and 3 share a stream but are different halves of it: 3 is how audio gets *into* the
server, 2 is how it gets *out to the rover*. Changing `media.audioPlayback.transport` affects both,
because both depend on that read leg.

### Video, for completeness

```
camera → video-publisher.sh → [server: <rover>] → WHEP → viewer browsers
```

Rover **publishes**. Config block: `media.video`. Transports: `whip`, `rtsp`, `mpegts`.

## Stream names and URLs

Names come from the rover's `name` and are **not configurable** — the server derives the same
names independently from the roster, so a hand-written URL that disagreed would publish
successfully to a path nothing reads.

| path | stream | derived RTSP URL |
|---|---|---|
| video | `<name>` | `rtsp://<host>:8554/<name>` |
| microphone | `<name>-audio` | `rtsp://<host>:8554/<name>-audio` |
| speaker | `<name>-fwd` | `rtsp://<host>:8554/<name>-fwd` |

`<host>` is `serverUrl`'s host. Ports come from `media.publishPort` (SRT), `media.rtspPort`, and
`media.whipPort` — the only per-deployment media settings. A VPS on a contiguous port block sets
all three; a default MediaMTX needs none.

WHIP endpoints are `http://<host>:8889/<stream>/whip`.

Setting a URL explicitly overrides derivation, for a non-standard layout or a one-off test.

## If a stream is not publishing

Remember there is **no automatic fallback** — see the warning at the top of this document. A
publisher that cannot use its configured transport exits and gets restarted; it does not quietly
switch to another one.

In order of likelihood:

1. **`rtsp: yes` missing on the media server.** This is the usual cause and it takes out every
   stream at once. See [server/mediamtx/mediamtx.yml](../server/mediamtx/mediamtx.yml).
2. **The RTSP UDP listeners are not bound.** `rtspAddress` governs only the TCP control port;
   `rtpAddress` and `rtcpAddress` are separate and default to every interface.
3. **`transport: whip` on a rover with ffmpeg < 7.1.** The muxer does not exist, so nothing
   publishes. `ffmpeg -muxers | grep whip` on the rover confirms it.
4. **Firewall.** RTSP needs TCP 8554 plus UDP 8000–8001 reachable from the rover.

Check the Pi stats card first — it shows what each stream is actually using, so a stream reading
`--` never started and one reading `SRT` is on the old path.

Immediate mitigation on any of these is `transport: mpegts` on the affected path.

A misspelled transport resolves to `rtsp` rather than failing, so a typo cannot stop a rover
publishing — but a *valid* transport the rover or server cannot serve will.

## Seeing which transport is in use

The **Rover Pi Stats** card shows it per stream, so it does not have to be read out of journald on
the Pi:

```
Video      Mic        Speaker
RTSP       SRT        RTSP
```

RTSP and WHIP render bright, SRT neutral. Underneath, each publisher writes its transport to
`/run/roverd/<stream>-transport` and roverd reports it in host stats. That needs
`RuntimeDirectory=roverd` on the media units, which the shipped units set.

## What changed versus the previous setup

- Video, mic and speaker now default to RTSP/TCP instead of MPEG-TS/SRT.
- Stream URLs are derived from the rover name for **every** transport, not just SRT. Adding a
  transport no longer means writing three more URLs per rover.
- `transport` is the single knob, per path, and `mpegts` restores the old behaviour exactly.
- **The server now needs `rtsp: yes`** (see
  [server/mediamtx/mediamtx.yml](../server/mediamtx/mediamtx.yml)). This is a required server-side
  change, not an optional one — without it, rovers on the default transport cannot publish.
- No transcoding was added anywhere: H264 in, H264 out, and audio is Opus end to end. MediaMTX
  repacketizes between containers rather than re-encoding. See
  [webrtc/TRANSCODING.md](../webrtc/TRANSCODING.md).
