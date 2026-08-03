# WebRTC latency work — what changed and why

33 commits. Three things: rover→browser latency cut by a measured 4–8×, a server upload leak
fixed, and the transmit method a rover is really using surfaced in the UI.

Everything here was measured rather than reasoned about. Several changes are the *opposite* of
what the obvious reasoning suggested — those cases are called out, because the wrong reasoning is
what someone will re-derive later.

---

## 1. The headline

Glass-to-glass video, rover → browser, measured against a real VPS over the internet:

| transport | p50 | run-to-run | verdict |
|---|---|---|---|
| MPEG-TS / SRT — as shipped today | 199–235ms | — | baseline |
| **RTSP / TCP** | **39ms** | 66 / 39 / 39 | **what production will use** |
| WHIP | 27ms | 26 / 27 / 29 | best, but needs ffmpeg ≥ 7.1 |
| RTSP / UDP | — | — | **fails entirely over the internet** |

Audio, same shape:

| path | before | after |
|---|---|---|
| rover mic → browser | 330ms | **183.7ms** |
| browser → rover (push-to-talk) | 138ms | **29.7ms** |
| server-originated (bonk / VIP / TTS) | 283ms | **30.5ms** |

The server-originated path improved most because it was the only one paying the MPEG-TS cost on
*both* legs.

### Where the latency actually was

**MediaMTX's MPEG-TS demux, ~115–160ms per leg.** Not SRT, not the encoder, not the browser, not
ffmpeg's muxer — each was eliminated by measurement. No flag on the rover could reach it, because
it is inside the server, which is why every prior attempt to tune the encoder went nowhere.

Detail and method: [webrtc/README.md](webrtc/README.md).

---

## 1b. ⚠️ Required server change: `rtsp: yes`

**Rovers now default to RTSP and there is no automatic fallback. If the media server does not have
`rtsp: yes`, rovers will not publish at all — no video, no microphone, no speaker.**

The config in this repo already has it ([server/mediamtx/mediamtx.yml](server/mediamtx/mediamtx.yml));
a hand-maintained config on a live server may not. Note also that `rtspAddress` governs only the TCP
control port — `rtpAddress` and `rtcpAddress` are separate listeners.

An earlier version of this work probed capabilities and demoted to MPEG-TS after three failures.
That was removed on purpose: **a rover silently running on the slow path is harder to notice than
one that is visibly down**, and the cascade was ~400 lines to paper over a one-line server setting.
The deliberate fallback is `transport: mpegts`, per path, which restores the previous behaviour
exactly.

Full detail: [docs/media-transports.md](docs/media-transports.md).

## 2. What a rover needs to roll this out

**This is not inert.** An earlier revision of this branch was — RTSP was opt-in per rover via a
hand-written URL — and that was deliberately dropped, twice, on request:

1. URLs are now **derived** from the server host plus the rover's `name`, so RTSP works with no
   per-rover configuration at all.
2. The transport **cascade was removed**, so `rtsp` is simply the default rather than something
   probed for.

Together those mean a rover that takes this code and changes nothing **switches to RTSP**. That is
the intent — it is where the latency win is — but it makes §1b a hard prerequisite rather than a
recommendation.

What that costs, stated honestly: rollout is no longer per-rover-inert. Enable `rtsp: yes` on the
server first, and it applies fleet-wide the moment rovers restart. `transport: mpegts` is the
per-path escape hatch, and it is exact.

What is still guarded, and is covered by tests rather than intent:

- a **misspelled** transport resolves to `rtsp` rather than stopping the publisher
- writing the transport-report state file can **never** take media down — a missing, unwritable, or
  file-blocked `/run/roverd` is survivable, which matters because these scripts run under `set -e`
- `whip` is never selected implicitly, so a rover with ffmpeg 5.1 cannot end up on a muxer it does
  not have

---

## 3. Two facts that must not get lost

### RTSP must be TCP. Never UDP.

RTSP/UDP works fine on loopback (13ms) and **fails completely across the internet**. The stream
publishes, MediaMTX reports the path ready, and no WebRTC reader ever starts because no complete
keyframe assembles.

The reasoning that looks right is backwards. UDP was originally chosen "to preserve the loss
behaviour SRT was chosen for" — but **SRT has ARQ retransmission and plain RTP/UDP has none**, so
RTSP/UDP is strictly *worse* than the SRT it replaces. One lost packet in a fragmented IDR is
unrecoverable.

TCP's real cost is head-of-line blocking on a lossy radio. If that bites, **the fix is WHIP, not
UDP** — WHIP is UDP *with* NACK/RTX.

Pinned in [pi/bin/video-publisher.sh](pi/bin/video-publisher.sh) and
[server/src/services/audioForwardService/workerEngine.js](server/src/services/audioForwardService/workerEngine.js),
with the retracted reasoning written next to it so it is not re-derived.

### Never put a DNS name in `webrtcAdditionalHosts`

MediaMTX resolves each entry **server-side** and advertises the result as an ICE candidate. On
Debian the machine's own hostname resolves through `/etc/hosts` to `127.0.1.1`, so the server
advertises a loopback candidate — ahead of the real one.

Browsers tolerate this, which is what makes it dangerous: WHEP playback works perfectly and hides
it. ffmpeg's WHIP muxer takes the *first* candidate, sends STUN to `127.0.1.1`, reaches its own
loopback, and fails every publish with `Connection refused`.

**A working browser is not proof that ICE is configured correctly.**

Fixed in [webrtc/deploy/mediamtx-vps.yml.template](webrtc/deploy/mediamtx-vps.yml.template). The
`__PUBLIC_HOST__` substitution was *removed* rather than left as a no-op, so the installer's
placeholder guard fails loudly if the DNS name is ever put back.

---

## 4. What changed, by area

### Rover (`pi/`)

| file | change |
|---|---|
| [pi/bin/video-publisher.sh](pi/bin/video-publisher.sh) | RTSP/TCP by default, `whip` and `mpegts` selectable; reports the transport in use |
| [pi/bin/audio-only-publisher.sh](pi/bin/audio-only-publisher.sh) | same cascade for the microphone |
| [pi/bin/audio-forward-listener.sh](pi/bin/audio-forward-listener.sh) | RTSP read option for forwarded audio |
| [pi/roverd/config.go](pi/roverd/config.go) | `transport`, `rtspUrl`, `whipUrl`; a typo'd transport normalises to `auto` rather than failing |
| [pi/roverd/media_transport.go](pi/roverd/media_transport.go) | **new** — reads the live transport the publishers report |
| [pi/roverd/host_stats.go](pi/roverd/host_stats.go) | adds `media` to the host-stats payload |
| [pi/systemd/](pi/systemd/) | `RuntimeDirectory=roverd` on the three media units |
| [pi/roverd/roverd.sample.yaml](pi/roverd/roverd.sample.yaml) | operator documentation, and the bitrate curve |

### Server (`server/`)

| file | change |
|---|---|
| [server/mediamtx/mediamtx.yml](server/mediamtx/mediamtx.yml) | RTSP ingest enabled, LAN-bound, `rtspTransports: [tcp, udp]`, MoQ off |
| [server/src/services/audioForwardService/](server/src/services/audioForwardService/) | RTSP publish option for server-originated audio |

Two subtleties worth knowing:

- `rtspAddress` governs **only the TCP control port**. The UDP RTP/RTCP listeners are separate and
  default to every interface, so they are pinned explicitly — otherwise "restricted to the LAN"
  was only half true.
- MediaMTX 1.19 enables MoQ by default, binding `:8892` on TCP **and** UDP. Nothing uses it, so it
  is off. Found by reading the startup log, not the docs.

### Browser (`webui/`)

[webui/src/lib/whepPlayer.js](webui/src/lib/whepPlayer.js):

- **Releases the WHEP session on teardown** — see §5, this is a real bandwidth fix
- Removed a hardcoded `turn:your.turn.server:3478` with placeholder credentials; ICE servers are
  now injectable, defaulting to STUN

[webui/src/components/PiHostStatsCard/index.jsx](webui/src/components/PiHostStatsCard/index.jsx) —
the transport display plus six bug fixes (§6).

### Deploy (`webrtc/deploy/`)

A packaged VPS install: [webrtc/deploy/install.sh](webrtc/deploy/install.sh) derives all 8 ports
from a single `--port-base`, because MediaMTX's defaults are scattered across the port space and a
host that only grants a contiguous block cannot use any of them. Instructions:
[webrtc/deploy/README-VPS.md](webrtc/deploy/README-VPS.md).

### Measurement harness (`webrtc/harness/`)

Ground truth, not inference: an in-band video timecode rendered as macroblock-aligned
high-contrast cells, decoded in the browser via `requestVideoFrameCallback`. Single machine, so
there is no clock-sync error to argue about. Audio uses onset detection on the audio thread.

[webrtc/harness/measure.js](webrtc/harness/measure.js) runs named scenarios and compares against a
stored baseline. [webrtc/harness/measure-concurrency.js](webrtc/harness/measure-concurrency.js)
runs a viewer ladder — that one found the leak below.

---

## 5. The upload leak (this is the one with production impact)

Found because the concurrency ladder reported **12 live sessions during its 8-viewer step**.

Closing an `RTCPeerConnection` is purely local. The server only learns the viewer is gone when ICE
times out:

| viewer leaves | server keeps sending |
|---|---|
| abrupt close — previous behaviour | **31,401 ms** |
| explicit WHEP DELETE | **18 ms** |

At the ~1.45 Mbps these streams measure, that is **~5.7 MB of upload per abandoned session**, and
every page reload or switch between rovers stacked another one. On a server whose upload is the
binding constraint, that is the single most expensive bug in this branch.

All three WHEP consumers route through `WhepPlayer`, so all three leaked. Verified fixed end to end
against the VPS through real CORS.

Three details there are load-bearing, not stylistic:

- `keepalive: true` — a plain fetch is cancelled when the document goes away, which is *precisely*
  the abandoned-tab case
- `releaseSession()` runs **before** `abortController.abort()` — reversed, the abort cancels the
  DELETE and the fix silently does nothing
- a `pagehide` listener, because closing a tab never calls `stop()`

Failure is best-effort throughout: if the DELETE fails, the server times the session out exactly as
before, so the worst case is the old behaviour.

### Concurrency, once the leak was gone

| viewers | p50 | server egress | per viewer | frames discarded | packets lost |
|---|---|---|---|---|---|
| 1 | 42ms | 1425 kbps | 1425 | 0 | 0 |
| 2 | 41ms | 2836 kbps | 1418 | 0 | 0 |
| 4 | 42ms | 5740 kbps | 1435 | 0 | 0 |
| 8 | 50ms | 11566 kbps | 1446 | 0 | 0 |

**Exactly linear at ~1.43 Mbps per viewer, with zero discards and zero loss.** MediaMTX's fan-out
is not a bottleneck — the upload link is the entire constraint. Eight viewers of one rover is
~11.6 Mbps.

---

## 6. The transport display

The Rover Pi Stats card now shows what each stream is actually using:

```
Video      Mic        Speaker
RTSP       SRT        RTSP
```

RTSP and WHIP render white, SRT neutral, and a runtime fallback gets a yellow `!` plus a warning
line reading `fell back to SRT: video`.

Each publisher writes its transport to `/run/roverd/<stream>-transport` on startup and roverd
reports it in host stats. Reported by the publisher rather than read from config, so a stream that
never started reads `--` instead of showing what it was *supposed* to be using — which is the
distinction that makes the card useful when something is wrong.

Reporting can never take media down — the requirement that shaped it:

- every write is guarded, because the scripts run under `set -e` and an unguarded failure would
  kill the pipeline over a status file
- a missing, unwritable, or file-blocked state directory is survivable — each is a test
- absent state reads as "not reported", never as a wrong transport

---

## 7. Bugs fixed

All confirmed against real data, not suspected.

| # | bug | why it mattered |
|---|---|---|
| 1 | **Power showed a green "OK" when the reading was never taken.** The throttle flags are `omitempty` pointers, so a failed `vcgencmd` omits them and absent was read as `false`. | Worst possible failure mode for a power warning — it looks like an all-clear. Now `--`. |
| 2 | **`54.1 GB / 281.2m` mixed two measurement windows.** Bytes came from `/sys` (interface lifetime), packets from `iw` (per-association). | They agree only until the first reconnect, then silently diverge. Packets now come from `/sys` too. |
| 3 | **Millions rendered as lowercase `m`** — the SI prefix for *milli*. | "281.2m packets" read as a fraction of a packet. |
| 4 | **`hostStatsEqual` never once held.** A shallow compare over a payload nesting three levels (`media.video.active`), reparsed from JSON every second. | Every nested value was a new reference, so it reported "changed" on every tick. The memoisation existed and did nothing. |
| 5 | **roverd's `errors` map was collected then discarded by the UI.** | A broken source showed only as a value quietly reading `--`. Now named, which is how a missing `vcgencmd` becomes noticeable. |
| 6 | ~~Dead `PLACEHOLDER_STATS`~~ — **this was not a bug and the removal was reverted.** | It is a deliberately retained dev fixture: swap it for `EMPTY_STATS` in the selector fallback and the card renders fully populated for layout review. `51863c4d` unslotted it while keeping it on purpose. Restored, extended to cover the new transport row, and commented so it is not deleted as "unused" again. |
| 7 | `gofmt` struct-tag misalignment in `config.go`. | — |
| 8 | Placeholder TURN server with placeholder credentials. | Every peer connection asked the browser to allocate against a host that cannot resolve. |
| 9 | A NUL byte in `funHelpers.js` made git treat the file as binary. | — |
| 10 | systemd hardening omitted `AF_NETLINK`, breaking Go's `net.Interfaces()`. | Surfaced to users as a WHEP 400 about network interfaces — reads like a client fault, is not one. |

---

## 8. Where the reasoning was wrong

Kept because someone will otherwise re-derive them. Each was believed, then disproved by
measurement.

| claim | reality |
|---|---|
| RTSP/UDP preserves SRT's loss behaviour | Backwards. SRT has ARQ, plain RTP/UDP has none. UDP fails outright over the internet. |
| ffmpeg's WHIP muxer can't parse hostname ICE candidates | Wrong mechanism. MediaMTX resolves the hostname *itself* to `127.0.1.1`. The guessed remedy was right for the wrong reason. |
| Per-viewer egress rises with viewer count | No — that was the harness serving its own leaked sessions. Flat at ~1.43 Mbps. |
| `pc.close()` ends the session | Local only. The server keeps sending for 31.4s. |
| The placeholder TURN entry stalls ICE | Costs nothing measurable (173 vs 172ms). A correctness fix, not a latency one. |
| 2 Mbps is ~3× more than needed | Measured on synthetic gradients. Real sensor gives qp ~21, so the headroom is real but modest. |
| `jitterBufferTarget = 0` will help | 13→13ms. Rejected rather than shipped as unmeasured risk for no gain. |
| `loudnorm` buffers ~1s | ~6ms. The 1s reading was grid aliasing in my own probe. |
| `-skip_frame nokey` speeds up snapshots | Measurably *worse* — 0.052 vs 0.042 cores. |
| `webrtcIPsFromInterfaces: no` fixes the netlink error | It does not. The cause was systemd blocking `AF_NETLINK`. |

**Nine further knobs were measured and rejected** — tabulated in
[webrtc/README.md](webrtc/README.md). Don't retry them without reading that first.

---

## 9. What is deliberately *not* in here

Stated plainly so nobody assumes it was covered.

1. **Bitrate is unchanged at 2 Mbps.** The full curve was measured on real sensor content over the
   live path:

   | bitrate | qp | actual egress |
   |---|---|---|
   | 2000000 | 21.7 | 1999 kbps |
   | 1200000 | 25.2 | 1188 kbps |
   | 800000 | 27.2 | 792 kbps |
   | 600000 | 31.7 | 596 kbps |

   The knee sits between 800k and 600k; blockiness shows around qp 30. The encoder consumes the
   whole 2 Mbps, so that figure is the per-viewer upload cost, not headroom. **Left alone because
   this was a webcam, not an OV5647**, and lowering every rover's picture quality on that evidence
   would be overreach. 1.2 Mbps would cut upload 40% at qp 25.2 if someone confirms it on rover
   hardware.

2. **TCP head-of-line blocking on a real lossy radio is unmeasured.** The VPS path had 0% loss, so
   it exercised the internet but not a bad WiFi link. The 66ms excursion RTSP/TCP shows on a *clean*
   path is probably a mild form of it. Proper measurement needs `netem`, which needs root.

3. **Server-side transcoding is untouched** — see [webrtc/TRANSCODING.md](webrtc/TRANSCODING.md).
   The latency work adds none (H264 in, H264 out on every ingest transport; MediaMTX repacketizes,
   it does not transcode). But ~0.14 cores per rover is spent always-on regardless: the libx264
   replay recorder (0.098) and the snapshot writer (0.042). `-c:v copy` on the recorder is 7.5×
   cheaper but needs GOP/segment alignment and replay-correctness testing — a separate piece of
   work with its own risk.

4. **WHIP is not the production path.** It is faster and steadier, but needs ffmpeg ≥ 7.1 and
   Raspberry Pi OS bookworm ships 5.1. The cascade skips it automatically. Upgrading ffmpeg on the
   Pis is the one remaining lever worth ~12ms plus the elimination of the RTSP/TCP tail.

5. **The transport reporting has not run on a physical Pi.** The chain was verified end to end —
   the shipped scripts' own writer functions driven directly, roverd reading the result back and
   marshalling the JSON the card indexes — but on a workstation, not on real hardware under real
   systemd.

---

## 10. Rolling it out

Per-change risk, fallback, and a suggested order: [webrtc/RISK.md](webrtc/RISK.md).

**Order matters, because this is not inert.** Enable `rtsp: yes` on the media server *first* (§1b)
— rovers switch to RTSP as soon as they restart, and without it they will not publish. Reverting is
still only a config edit: `transport: mpegts` per path.

**A second deployment step is not optional either.** `RuntimeDirectory=roverd` was added to the three media
units, because they run as the unprivileged `roverd` user which cannot `mkdir` inside root-owned
`/run`. Without it the transport write is skipped and the card shows nothing. So this needs a
`systemctl daemon-reload` and a restart of the media units, not just new script binaries.

### Verifying

```bash
go build -C pi/roverd ./... && go vet -C pi/roverd ./... && go test -C pi/roverd ./...
node --test $(find server/src -name '*.test.js' -not -path '*/node_modules/*')
for t in video-publisher audio-only-publisher audio-forward-listener; do bash pi/bin/$t.test.sh; done
bash -n webrtc/deploy/install.sh
```

Currently **16 Go tests, 46 server tests, and 41 bash tests** across the three publisher scripts
(22 / 11 / 8), all passing. One Go test pins the host-stats wire format, so renaming a field the
card indexes fails the build rather than silently blanking the display.

The harness needs a one-time fetch of MediaMTX and Chromium — `cd webrtc && ./setup.sh`. Neither is
committed.
