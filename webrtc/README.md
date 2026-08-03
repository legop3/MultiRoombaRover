# WebRTC latency harness

Measures and tunes the rover media path end to end. Self-contained: it brings its
own MediaMTX and headless Chromium and needs no rover, no node server, and no
network.

```bash
./setup.sh                                  # fetch pinned mediamtx + chromium
node harness/measure.js                     # one baseline run
node harness/measure.js --list              # what can be measured
node harness/measure.js --all --repeats 3   # full sweep
node harness/measure.js baseline --continuous --compare baseline-sweep.json
```

## What it measures, and why that is trustworthy

Every generated video frame carries the wall-clock time it was produced, painted
into the picture as 16px high-contrast cells. Whatever finally renders that frame
reads the cells back and subtracts from its own clock.

Two properties make this ground truth rather than an estimate:

- **No clock synchronization.** Producer and consumer are the same machine reading
  the same wall clock, so there is no offset to correct and no round-trip to halve.
- **It includes everything.** Encode, mux, transport, ingest, repacketization, ICE,
  jitter buffer, decode, and compositor presentation are all inside the number,
  because the timestamp travels *in the picture* rather than alongside it.

Cells rather than rendered digits because OCR fails exactly when the picture
degrades, which is when a latency measurement matters most. A 16px cell is
macroblock-aligned and survives heavy quantization.

Audio has nowhere to hide a payload that Opus will not alter, so it is timed by
onset instead: a 1kHz burst on a fixed grid, detected in an AudioWorklet on the
audio thread where an onset can be placed within ~3ms.

## Latency is only half the report

Every knob here can be pushed until the video is a blocky mess, so quality is
reported next to timing and a run is judged on both. The number to watch is
`averageQp` — the average quantizer the encoder settled on. Rising QP *is* the
picture going blocky. `freezeCount` and `framesPerSecond` guard against the other
failure mode, where latency improves because frames are being thrown away.

`measure.js --compare` refuses to call a sub-5ms change meaningful, because repeated
runs of an identical configuration on a loaded workstation drift by a few
milliseconds and treating that as signal would make the harness useless.

## Findings

640x480, 30fps, 2Mbps, all on loopback. `p50`/`attach` in ms, `qp` is the average
quantizer (higher = blockier).

| scenario | p50 | p95 | attach | qp | verdict |
|---|---|---|---|---|---|
| baseline | 172 | 180 | 4132 | 1.2 | as shipped |
| **rtsp-ingest** | **12** | **20** | 3943 | 1.3 | **-160ms, no quality cost** |
| gop-30 | 172 | 179 | **1162** | 6.5 | -3s attach |
| gop-15 | 175 | 183 | **653** | 12.2 | -3.5s attach, real quality cost |
| vbv-tight | 171 | 178 | 4140 | 6.2 | no win, quality worse |
| vbv-none | 172 | 182 | 4136 | 0 | no change |
| srt-0 | 173 | 181 | 4147 | 0.6 | no change |
| mpegts-direct | 175 | 182 | 4089 | 1.1 | no change |
| playout-default | 172 | 179 | 4160 | 0.6 | no change |
| placeholder-turn | 173 | 181 | 4145 | 0.7 | no measurable cost on loopback |

### The 160ms is the mpegts container, on MediaMTX's demux side

Publishing the *identical encoded frames* over RTSP instead of mpegts-over-SRT takes
glass-to-glass from 172ms to **12ms** at unchanged quality. The elimination is clean:

- **Not SRT.** `srt-0` (latency 10 → 0) moved nothing, so SRT's timestamp-based
  delivery delay is not the cost.
- **Not the encoder.** Same libx264 invocation in both runs.
- **Not the browser.** Jitter buffer, decode, and processing total ~9–18ms.
- **Not ffmpeg's muxer.** `mpegts-direct` adds `-max_interleave_delta 0`,
  `-avioflags direct`, and `-max_delay 0` and changes nothing, which places the delay
  in MediaMTX's mpegts demux rather than anywhere on the rover.

That last point matters for how it can be fixed: no rover-side ffmpeg flag reaches
it. The container has to change.

**Transport is not a free choice, though.** SRT was presumably chosen for a lossy
WiFi link, and RTSP over TCP trades that for head-of-line blocking. Prefer a UDP RTP
ingest (`rtsp-udp`, or MediaMTX's WHIP ingest) so the latency win does not cost loss
tolerance.

### Real-camera bitrate curve, and the recommendation

WHIP ingest, gop 30, real camera at 640x480@30. `egress` is measured per-viewer video
rate, not the configured ceiling:

| configured | measured egress | qp | p50 | p95 | freezes | fps |
|---|---|---|---|---|---|---|
| 2000 kbps | 2016 | 20.9 | 15 | 31 | 0 | 30 |
| 1200 kbps | 1196 | 23.3 | 13 | 28 | 0 | 30 |
| **800 kbps** | **800** | **25.1** | 12 | 27 | 0 | 30 |
| 600 kbps | 600 | 26.3 | 12 | 29 | 0 | 30 |

Two things to read off this:

**Real content saturates whatever budget it is given.** Measured egress tracks the
configured bitrate almost exactly (2016/1196/800/600), unlike the synthetic source
which only reached 1323 kbps against a 2000 ceiling. So on a real rover the configured
bitrate *is* the upload cost, and lowering it is a direct, predictable saving.

**The quality curve is shallow.** A 70% bitrate cut moves qp from 20.9 to only 26.3,
and visible blockiness starts around 30. **800 kbps cuts per-viewer egress by 60% at
qp 25.1**, keeping margin before the blockiness threshold, with no freezes and full
frame rate. Since this webcam is MJPEG-only and therefore double-compressed, a real
OV5647 at the same bitrate should land *below* qp 25.1 — so 800 kbps is a conservative
starting point, not an aggressive one.

### Egress neutrality of the container change, measured

Same encoder settings, only ingest container differs: baseline 1323 kbps, WHIP 1362
kbps. Within noise, confirming by measurement what the structure already implied —
egress to browsers is RTP either way, so the latency fix does not spend upload budget.

### Attach time: earlier numbers were a harness artifact

The early sweeps reported attach times of ~4100ms at gop 120 against ~1160ms at gop 30,
and that difference was largely **my harness, not the GOP**. Those runs used a fixed
warmup sleep and could start the browser before the publisher was actually live, so the
measurement included waiting for the publisher itself.

With attach measured against an already-established stream — which is what production
looks like, since rovers stream continuously and viewers join an existing stream — GOP
length makes no meaningful difference:

| scenario | gop | attach |
|---|---|---|
| baseline | 120 | 177ms |
| whip | 120 | 264ms |
| cam-800k | 30 | 195ms |
| cam-600k | 30 | 231ms |

All ~180–260ms regardless. MediaMTX serves a cached keyframe to a newly attaching
reader, so a long GOP does not make a viewer wait for the next IDR.

**Consequence: shortening the GOP is not worth its cost.** It buys little for a joining
viewer and it does cost quality — at fixed bitrate, more keyframes leave fewer bits for
P-frames. Keeping `--intra 120` and spending that bitrate on picture quality is the
better trade. Attach time for a *cold* stream (rover just booted) is still bounded by
the GOP, so shorten it only if cold-start time turns out to matter in practice.

### Recommended configuration

**WHIP ingest, keep gop 120, drop bitrate to ~800 kbps.**

| | current | recommended | change |
|---|---|---|---|
| glass-to-glass p50 | 172ms | **12ms** | -93% |
| egress per viewer | ~2000 kbps | **800 kbps** | -60% |
| qp (real camera) | 20.9 | 25.1 | still below the ~30 blockiness threshold |
| freezes / fps | 0 / 30 | 0 / 30 | unchanged |

WHIP rather than RTSP because both eliminate the same 160ms, but WHIP is UDP *with* NACK/RTX —
retransmission that bare RTP/UDP lacks, which is exactly why RTSP/UDP fails over the internet and
WHIP does not. It also needs no new server listener and puts the rover on the same protocol the
viewers already use. Live measurement bears this out: WHIP is both faster (27ms vs 39ms) and
steadier (spread of 3ms vs an excursion to 66ms) than RTSP/TCP.

**On a Pi this is aspirational, not available.** The `whip` muxer needs ffmpeg >= 7.1 and
Raspberry Pi OS bookworm ships 5.1, so **RTSP/TCP is the production path** and the transport
cascade falls back to it automatically. The figures above were measured with ffmpeg 8.1.2 on a
workstation.

Validate the 800 kbps figure on real rover hardware before rolling it out — see the
bitrate section for why this machine can only bracket it.

### Corrections

Two earlier claims in this repo's history did not survive measurement, recorded here
so they are not repeated:

- The placeholder TURN entry in `whepPlayer.js` was described as stalling ICE
  gathering. On loopback it costs nothing measurable (173ms vs 172ms, attach 4145 vs
  4132) because host candidates win immediately. Shipping credentials for a
  nonexistent host is still wrong, but it is not a latency bug at this scale. It may
  cost real time on a VPS, which is where to test it.
- `lib/srtProbe.js` reported 383ms and that was quoted as a pipeline figure. It is
  not — see below.
- The WHIP publish failure was attributed to ffmpeg's minimal muxer being unable to parse a
  hostname-form ICE candidate. Wrong mechanism: MediaMTX resolves the hostname itself, server
  side, to `127.0.1.1`, and ffmpeg then takes that first candidate. The remedy guessed at —
  advertise the IP only — happened to be right, which is exactly why the reasoning needed
  checking rather than the fix being accepted as confirmation.
- Per-viewer egress appeared to rise with viewer count (1434 kbps at one viewer, 2276 at eight).
  That was the harness serving the previous ladder step's leaked sessions. Per viewer the cost is
  flat. A measurement tool that leaks the same resource it is measuring will report the leak as a
  property of the system.

## Bandwidth: read this before changing any bitrate

Production server upload is the binding constraint, and **every WHEP viewer pays the
full stream bitrate**, so egress per viewer is measured and reported (`vkbps`) rather
than inferred from the configured bitrate. The configured value is only a ceiling the
encoder need not reach.

**The ingest container does not affect server upload.** Egress to browsers is RTP
whether the rover publishes mpegts/SRT, RTSP, or WHIP, so the 160ms latency fix is
bandwidth-neutral on the constrained direction. It slightly *reduces* the rover's own
upload by dropping mpegts framing overhead. Encoder bitrate is the only real lever on
the server's upload budget.

### The content you measure on decides the answer, and both sources here are wrong

Measured qp at the same 2Mbps, 640x480@30:

| source | qp at 2 Mbps | why it is misleading |
|---|---|---|
| synthetic gradients | 0.5 – 1.2 | compresses far too easily; suggests huge headroom that does not exist |
| USB webcam (MJPEG) | 21.3 – 22 | MJPEG-decoded input carries JPEG artifacts that h264 then spends bits re-encoding |

A real OV5647 feeding `rpicam-vid` sits **between** these: it has genuine sensor noise
unlike the gradients, but it is encoded once from raw rather than twice. This webcam
only offers MJPEG (`v4l2-ctl --list-formats-ext` shows no raw format), so the
double-compression penalty cannot be avoided here.

**Therefore: do not set a production bitrate from numbers measured on this machine.**
Run the `cam-*` ladder on a real rover and read the knee off that. What the local
numbers do establish is the method, the tooling, and the direction — and that at
qp ~21 on a noisy source the shipped 2Mbps is *not* the extravagant over-provision the
synthetic rows made it look like.

## Knobs measured and rejected

Recorded because a negative result is worth as much as a positive one here, and because
each of these looks obviously worth doing until measured. The 5ms significance threshold
from `--compare` is applied consistently: anything below it is noise, not a win.

| knob | result | verdict |
|---|---|---|
| `jitterBufferTarget = 0` (video) | 13ms → 13ms, buffer 8.0 → 7.8ms | no effect; Chromium already at its floor |
| `jitterBufferTarget = 0` (audio) | 181.2 → 177.4ms | **3.8ms, below threshold**; buffer moved 71.6 → 64.6ms but the total did not follow |
| drop `-use_wallclock_as_timestamps` | 12ms → 12ms | no effect, and the rover needs it — raw h264 carries no timestamps |
| 60fps instead of 30 | **20ms, worse**; egress +33%, qp 1.6 → 5.1 | worse on all three axes |
| 10ms Opus frames | −16ms but 1320 concealed samples on RTSP/UDP | audible dropouts; only safe on WHIP, which has RTX |
| `vbv-tight` / `vbv-none` | no latency change, qp 1.2 → 6.2 | quality cost for nothing |
| `srt latency 0` | no change | SRT delivery delay was never the cost |
| `mpegts` low-latency mux flags | no change | places the delay in the server's demux, not ffmpeg's mux |
| shorter GOP | no steady-state change; attach unaffected on an established stream | costs quality for a problem MediaMTX's keyframe cache already solves |

**60fps deserves a note** because it is the most counter-intuitive. Halving the frame
interval should reduce how long a frame waits before encode, but measured latency nearly
doubled while egress rose a third. More frames means more encode and packetisation work per
second, and this machine is running encoder, server, and browser at once. On a Pi Zero 2 W
the CPU pressure would be worse, not better.

### Where the remaining latency actually is

Video at 12ms is effectively at the floor: ~8ms receiver jitter buffer, ~0.6ms decode, the
rest packetisation and presentation. None of it is reachable from the pipeline.

Audio at ~181ms is dominated by a ~65ms receiver jitter buffer plus the headless
`AudioContext` output buffer. **The audio absolute figure is inflated by the harness** — a
headless browser has no real output device, so that buffer is arbitrary software latency a
real listener would not pay in the same form. The 330 → 181ms improvement is sound because
both sides pay it identically; the absolute is not a user-facing number.

One harness limitation worth stating: audio runs sometimes report several hundred concealed
samples even on loopback, where there is no loss to conceal. That points at the synthetic
source's node-timer pacing producing occasional gaps, not at the transport. Do not read
small concealment counts here as a pipeline defect — the RTSP-versus-WHIP comparison at
matched settings is still valid because both share the same source.

## Known caveat in the synthetic source

A real rover encodes in hardware via `rpicam-vid` and ffmpeg only does `-c:v copy`.
This harness has no hardware encoder, so libx264 with `-tune zerolatency` stands in.
That is a fair substitute for transport measurement but it is **not** a fair source
for attributing encoder latency: some of the ~155ms upstream figure may be x264 that
a real rover never pays. Isolate before blaming the pipeline.

## The SRT read-back probe is not a latency measure

`lib/srtProbe.js` reads the published stream back over SRT. It reported 385ms against
the same frames the browser saw at 174ms. Since the browser number is a superset of
everything that probe measures, ~210ms of that is the probe's own ffmpeg demux and
decode cost. Its latency samples are only comparable to other runs of itself.

It is still useful for what it can honestly answer: whether the stream is decodable,
what frame cadence MediaMTX hands out, and whether frames are duplicated before
WebRTC is involved. It also costs CPU on the measuring machine, so leave it off for a
clean baseline.

## Live results from a real VPS

Loopback numbers are a floor. Measured against a deployed VPS with 11.9ms RTT and 0% loss,
publisher and viewer both remote from the server — the same two-hop shape as production
(rover to VPS to viewer):

| ingest | p50 | p95 | egress | qp | freezes | verdict |
|---|---|---|---|---|---|---|
| mpegts / SRT | 199–235ms | 208–242 | ~1360 kbps | 0.7–1.0 | 0 | as shipped |
| **RTSP / TCP** | **39ms typical** | 47–49 | ~1360 kbps | 1.0–1.1 | 0 | **-170ms, same quality and egress** |
| **WHIP** | **27ms** | 34–37 | ~1350 kbps | 0.7–1.3 | 0 | **best, and the most stable** |
| RTSP / UDP | — | — | — | — | — | **does not work over the internet** |

Paired in one run, 450 samples each, and repeated across several sessions. The container win
survives the real network. Ranges are run-to-run spread on a live internet path, not error bars
on a single measurement.

**WHIP is the most stable, not just the fastest.** Three repeats each:

| | trial 1 | trial 2 | trial 3 | jitter buffer |
|---|---|---|---|---|
| WHIP | 26ms | 27ms | 29ms | 8.5 / 10.1 / 13.3ms |
| RTSP / TCP | 66ms | 39ms | 39ms | 15.7 / 8.6 / 8.4ms |

RTSP/TCP has a tail that WHIP does not, and it tracks jitter buffer growth — consistent with TCP
head-of-line blocking, which is the cost this path knowingly accepts. RTSP/TCP remains the
production recommendation only because WHIP needs ffmpeg >= 7.1 and the Pis ship 5.1; if that
changes, WHIP is the better path on both latency and stability.

### RTSP must be TCP, and the earlier UDP recommendation was wrong

RTSP/UDP failed outright. The stream published, MediaMTX reported `ready=True` with an H264
track, and a WHEP request against the path still rejected an invalid offer in 35ms — so the
server was healthy and responsive. But no WebRTC reader ever started, because no complete
keyframe assembled.

**Plain RTP/UDP has no retransmission and SRT has ARQ.** UDP was originally chosen here "to
preserve the loss behaviour SRT was chosen for", and that reasoning was backwards: it made the
path strictly *worse* than what it replaced, because a fragmented IDR losing a single packet is
unrecoverable. Loopback cannot show this — there is no loss to lose.

TCP does add head-of-line blocking, which is a genuine cost on a lossy WiFi link. It is still the
right trade: a stream that stalls forever is worse than one that occasionally hitches. WHIP would
be better than both, since it is UDP *with* NACK/RTX, but it needs ffmpeg >= 7.1 and the Pis ship
5.1.

### The WHIP failure was our deploy template, not ffmpeg

WHIP publish failed against the VPS while WHEP read from the same server worked, which made it
look like a limitation of ffmpeg's minimal muxer. It was not.

MediaMTX resolves every `webrtcAdditionalHosts` entry **locally** and advertises the result as an
ICE host candidate. The deploy template listed the DNS name alongside the public IP, and on Debian
the machine's own hostname resolves through `/etc/hosts` to `127.0.1.1`. So the server advertised a
loopback candidate — ahead of the real one:

```
a=candidate:1478248150 1 udp 2130706431 127.0.1.1 15940 typ host
a=candidate:1881708280 1 udp 2130706431 79.140.195.28 15940 typ host
```

Browsers tolerate this, because ICE tries every candidate in parallel and discards the dud. That
is why every WHEP measurement passed and hid the bug. ffmpeg's WHIP muxer takes the **first**
candidate only, sends STUN to `127.0.1.1`, reaches its own loopback, and fails:

```
transport=udp://127.0.1.1:15940
Failed to read message
Could not write header (incorrect codec parameters ?): Connection refused
```

With the IP alone the same publish completes and measures 27ms. The template now advertises only
`__PUBLIC_IP__`, and the `__PUBLIC_HOST__` substitution was removed rather than left as a no-op so
the installer's placeholder guard fails loudly if the DNS name is ever put back.

The general lesson: **a working browser is not proof that ICE is configured correctly.** Browser
ICE is forgiving enough to mask a bad candidate list that stricter clients cannot survive.

## Concurrency: what each extra viewer costs

Every WHEP viewer gets its own copy of the stream, so this is the number the upload budget is
actually spent on. One publisher, a ladder of concurrent viewers, measured live:

| viewers | p50 | path egress | per viewer | frames discarded | packets lost | local CPU |
|---|---|---|---|---|---|---|
| 1 | 42ms | 1425 kbps | 1425 | 0 | 0 | 31% |
| 2 | 41ms | 2836 kbps | 1418 | 0 | 0 | 38% |
| 4 | 42ms | 5740 kbps | 1435 | 0 | 0 | 49% |
| 8 | 50ms | 11566 kbps | 1446 | 0 | 0 | 63% |

**Egress is exactly linear at ~1.43 Mbps per viewer, and MediaMTX's fan-out is not a bottleneck** —
zero frames discarded and zero packets lost throughout. The constraint is the upload link, nothing
else. Eight viewers of one rover is ~11.6 Mbps.

`framesDiscarded` is the signal to watch: it is MediaMTX admitting it could not send what it
wanted. While it is zero, the server is keeping up regardless of what latency does. Local CPU is
reported alongside because every viewer decodes h264 on the measuring machine — at 63% the small
p50 rise at 8 viewers is attributable to this host, not the deployment.

### Departed viewers used to keep costing upload for 31 seconds

Found by that ladder reporting 12 live sessions during its 8-viewer step. Closing an
`RTCPeerConnection` is purely local; the server only finds out when ICE times out:

| viewer leaves | server keeps sending |
|---|---|
| abrupt close (previous behaviour) | **31401ms** |
| explicit WHEP DELETE | **18ms** |

At ~1.45 Mbps that is ~5.7MB of upload per abandoned session, and every reload or switch between
rovers stacked another one. `whepPlayer.js` now records the resource URL from the POST's `Location`
header and DELETEs it on teardown, with `keepalive: true` so it survives page teardown and a
`pagehide` listener because closing a tab never calls `stop()`.

The harness probe leaked identically, which is why the first ladder run showed per-viewer egress
*rising* with scale — an artifact of serving the previous step's ghosts. Both are fixed; the table
above is from the clean run, where live sessions match the viewer count exactly.

## Server CPU: no acceleration, so transcoding matters

The production server has no hardware video acceleration. **The latency work adds no
transcoding** - verified H264 in / H264 out on all three ingest transports, because MediaMTX
repacketizes rather than transcodes, and Opus is already WebRTC's native audio codec.

What does cost CPU is separate from this work and always on, roughly **0.14 cores per rover**
before anyone is watching: a `libx264` replay segment recorder (0.098) and a snapshot writer
that decodes 30fps to emit 1fps (0.042). Full audit, measured figures, and one optimisation that
measurement rejected are in [TRANSCODING.md](TRANSCODING.md).

## Layout

```
config/mediamtx-baseline.yml   the control. mirrors production minus auth; do not tune
harness/measure.js             scenario runner, comparison, JSON output
harness/lib/timecode.js        in-band timestamp spec, shared by every probe
harness/lib/videoSource.js     synthetic rover source mirroring video-publisher.sh
harness/lib/audioSource.js     tone-burst grid mirroring audio-only-publisher.sh
harness/lib/browserProbe.js    Chromium lifecycle and measurement flags
harness/page/whep-probe.js     in-page video decode via requestVideoFrameCallback
harness/page/audio-probe.js    in-page onset detection via AudioWorklet
harness/smoke-whep.js          one verbose end-to-end run
```

`config/mediamtx-baseline.yml` is the experiment's control and is deliberately not
tuned. Tuning goes in a sibling config so every change is measurable as a diff
against recorded numbers rather than against an unrecorded moving target.

Chromium runs with frame-rate limiting, GPU vsync, and background throttling
disabled. Those defaults would layer their own smoothing over the pipeline and the
result would describe Chromium policy rather than the code under test. They are a
measurement instrument, not a production recommendation.
