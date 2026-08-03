# Latency changes: risk and fallbacks

Every production change made for latency, what breaks if it goes wrong, and what catches
it. Ordered by blast radius.

The governing principle: **a rover that publishes slow video is fine, a rover that
publishes no video is not.** Every fallback below prefers losing the 160ms improvement
over losing the stream.

---

## 1. Rover video transport (`pi/bin/video-publisher.sh`, `pi/roverd/config.go`)

**Change.** New `transport` setting selecting how encoded frames reach the server. **`rtsp` is
the default**, with `whip` and `mpegts` selectable. Worth ~160ms. URLs are derived from the
server host plus the rover's `name`, so no per-rover URL configuration is needed.

**This is the highest-risk change in the branch, because it is not inert.** A rover that takes
this code and changes nothing switches to RTSP on restart.

| risk | severity | why |
|---|---|---|
| **Server has no RTSP listener** | **high** | `rtsp: no` was the shipped default. With no automatic fallback, every rover that restarts against such a server stops publishing entirely. This is why `rtsp: yes` is step 1 of the rollout, not a precaution. |
| `transport: whip` set on a rover with old ffmpeg | medium | Needs ffmpeg ≥ 7.1; Raspberry Pi OS bookworm ships **5.1**. Nothing selects WHIP implicitly, so this only happens if someone sets it — but if they do, that stream does not publish. |
| TCP head-of-line blocking on lossy WiFi | medium | Unmeasured; the VPS test had 0% loss. |
| Typo in the `transport` value | low | Resolves to `rtsp` rather than stopping the publisher. |

**Fallbacks — deliberately fewer than there were.**

1. **`transport: mpegts` per path.** The explicit revert, exact and one line. This is now *the*
   fallback.
2. **Invalid values corrected, not rejected.** An unrecognised `transport` normalises to `rtsp`
   rather than erroring the daemon or stopping a stream.
3. **systemd restart.** A publisher that cannot use its transport exits and is restarted, so the
   failure is visible rather than absorbed.

**What was removed, and why.** An earlier revision probed `ffmpeg -muxers`, ranked WHIP → RTSP →
MPEG-TS, and demoted permanently after three consecutive failures — so a broken endpoint cost
latency rather than video. That was removed on request, and the reasoning is worth keeping: **a
rover silently running on the slow path is harder to notice than one that is visibly down**, and
the cascade was ~400 lines across three scripts, the Go config and the UI to work around a
one-line server setting. The cost of removing it is that misconfiguration now takes streams down
instead of degrading them, which is exactly why the rollout order matters.

**Measured against a real VPS, and it changed the transport choice.** RTSP/TCP gave 73ms against
241ms for MPEG-TS/SRT in the same run, 450 samples each, at identical egress and quality. **RTSP
over UDP failed completely**: published fine, reported ready, but no WebRTC reader could start
because plain RTP/UDP has no retransmission and a fragmented keyframe never assembled. SRT has
ARQ, so the original "UDP preserves SRT's loss behaviour" reasoning was backwards — it was
strictly worse than what it replaced. The publishers now default to TCP, overridable via
`ROVERD_VIDEO_RTSP_TRANSPORT` for anyone wanting to measure their own link.

**Residual risk.** TCP head-of-line blocking on a lossy rover WiFi link is still unmeasured — the
VPS test had 0% loss, so it exercised the internet path but not a bad radio link. Roll out to one
rover, watch `freezeCount` and `packetsLost`, and keep `transport: mpegts` as the one-line revert.
If head-of-line blocking does bite, WHIP is the fix rather than reverting to UDP, since it is UDP
with retransmission.

---

## 1b. Rover audio transport (`pi/bin/audio-only-publisher.sh`)

**Change.** Same cascade on the microphone path, but only `whip` or `mpegts` — RTSP
audio-only ingest is unused. Measured 338ms over MPEG-TS against 181ms over WHIP, a 157ms
saving that matches the video finding, because it is the same server-side demux cost.

**Change (updated).** RTSP was added to the audio cascade after verifying MediaMTX accepts
an Opus-only RTSP stream (it reports `1 track (Opus)`). That removes the earlier limitation:
a rover on bookworm's ffmpeg 5.1 now gets the audio improvement too, without upgrading
ffmpeg. Measured 330ms → 183.7ms over RTSP.

**Risks.** Identical in shape to the video transport.

One measured caution: **10ms Opus frames are only safe on WHIP.** Halving the frame duration
saves ~16ms, but on RTSP/UDP it produced 1320 concealed samples — audible dropouts — where
WHIP at 10ms stayed clean. More packets with no retransmission means more loss impact, and
WHIP has RTX where raw RTP/UDP does not. Frame duration is therefore left at 20ms and is not
exposed as a rover setting.

**Fallbacks.** Same as the video path, and same caveat: **not inert.** `rtsp` is the default here
too, so this path also depends on `rtsp: yes` being enabled server-side before rovers restart. The
revert is `audioCapture.transport: mpegts`. Covered by `pi/bin/audio-only-publisher.test.sh`,
8 cases.

**Residual risk.** Audio absolute latency figures from the harness are less trustworthy
than video ones: a headless browser has no real output device, so `AudioContext.outputLatency`
reflects an arbitrary software buffer that is inside the measurement. The 338 → 181ms
*comparison* is sound because both sides pay the identical overhead, but neither absolute
should be quoted as a user-facing number.

---

## 1c. Rover forwarded-audio read (`pi/bin/audio-forward-listener.sh`)

**Change.** The rover can read forwarded audio (push-to-talk, VIP uploads, server sounds)
over RTSP instead of SRT/MPEG-TS. Measured browser-to-rover at a matched normalize setting:
**138ms over SRT against 29.7ms over RTSP, ~108ms.**

The browser already publishes over WHIP in production, so this read leg was the remaining
cost on that direction.

**Risks.** Same shape as the other transports, minus the ffmpeg version problem — RTSP works
on ffmpeg 4.x+, so every current rover can use it.

**Fallbacks.** As above, and **not inert**: `rtsp` is the default on this path too, so the rover
speaker also goes silent if the server has no RTSP listener. The revert is
`audioPlayback.transport: mpegts`. Unrecognised values — including `whip`, which is not selectable
on a read path — normalise to `rtsp`. Covered by `pi/bin/audio-forward-listener.test.sh`, 10 cases.

**Residual risk.** The measurement excludes ALSA's buffer inside `aplay` and the speaker
itself, so it is browser-to-PCM and a lower bound on what a person in the room hears.

### Two measurement corrections recorded here

Both were caught locally rather than shipped, and both are the kind of error that produces a
confident wrong number:

- **Grid aliasing.** The first uplink run reported **16.7ms** for RTSP and I nearly reported a
  120ms win. A 1000ms burst grid cannot distinguish 16.7ms from 1016.7ms, and rounding to the
  nearest slot merged them. What exposed it was a **negative latency** reading, which is
  physically impossible. Fixed by attributing forward-only (floor, not round), widening the
  grid to 3000ms, and warning when the sample spread is wide enough to indicate two clusters
  rather than one distribution — bimodality that a p50 otherwise hides.
- **`loudnorm` does not buffer ~1s.** I inferred that from the negative reading and it was
  wrong; at matched transport it costs about 6ms. Also, do not compare across normalize
  settings with this probe: `loudnorm` amplifies, so a fixed envelope threshold trips earlier
  on the burst ramp and reports *lower* latency for the filtered case. That is a detector
  artifact, not a result.

---

## 2. Enabling RTSP on the media server (`server/mediamtx/mediamtx.yml`)

**Change.** `rtsp: no` → `yes`, bound to `192.168.0.100:8554`, UDP and TCP.

**Risks.** A new listening port is new attack surface. Wrong bind address could expose
ingest to the internet.

**Fallbacks and mitigations.**

- Bound to the **LAN interface, not `0.0.0.0`**, so enabling ingest does not publish a
  port to the internet. Note this needed three settings, not one: `rtspAddress` governs
  only the TCP control port, while the UDP RTP/RTCP listeners are separate and default to
  every interface on `:8000` and `:8001`. `rtpAddress` and `rtcpAddress` are pinned too.
  This was caught by reading mediamtx's actual startup log rather than trusting the one
  setting - the first version of this change left two UDP ports open on all interfaces.
- Publishing still authenticates via the existing `authHTTPAddress`, the same as every
  other protocol, so this is not unauthenticated ingest.
- `rtsp: no` fully reverts it, and rovers fall back automatically.

Also **`moq: no`** is now set. MediaMTX 1.19 enables MoQ (Media over QUIC) by default, binding
:8892 on both TCP and UDP. Nothing here uses it. It was found by reading the startup log during
VPS config validation, not by reading the docs — the same way the RTP/RTCP bind addresses were
found. Unused listeners are only attack surface.

**Residual risk.** The bind address is environment-specific and **must be checked against
your actual network before deploying.** If `192.168.0.100` is not the right interface,
mediamtx will fail to bind and log it at startup.

---

## 1d. Server-originated audio publish (`server/src/services/audioForwardService/`)

**Change.** The server can publish forwarded audio into MediaMTX over RTSP instead of MPEG-TS,
used when the target rover has an `audioPlayback.rtspUrl` configured.

**Why it is the biggest audio win.** This is the only path with MPEG-TS on *both* legs, so it
pays the container cost twice. Measured server publish through to rover PCM:

| publish | rover reads | p50 |
|---|---|---|
| mpegts | srt | **283ms** (current) |
| mpegts | rtsp | 168ms |
| rtsp | srt | 151.5ms |
| **rtsp** | **rtsp** | **30.5ms** |

**283 → 30.5ms.** The legs are roughly additive at ~115ms and ~131ms, which is a useful
consistency check on the whole attribution.

**Risks.** RTSP publish only works if the rover can read what was published, so it is gated on
the rover having `rtspUrl` set.

**Fallbacks.** Absent `rtspUrl` keeps exactly today's MPEG-TS publish. The two legs migrate
independently in either order — each alone still helps, per the middle two rows.

**Residual risk.** If RTSP publish fails the worker restarts rather than falling back to MPEG-TS.
This now matches the rover publishers, which no longer demote either, so the behaviour is at least
consistent across both sides: a transport that does not work produces a restart, not a silent
downgrade. The mitigation is the same — set the transport back to `mpegts` — and the prerequisite is
the same, `rtsp: yes` on the media server.

---

## 3. Video bitrate guidance (`pi/roverd/roverd.sample.yaml`)

**Change.** Comment only. `bitrate` default is **unchanged at 2000000**; the measured
tradeoff for 800000 is documented next to it.

**Risk.** Very low — no behavioural change. If an operator follows the guidance, the risk
is picture quality on a camera and lighting we did not measure.

**Fallback.** It is one config value, revertible in place. The `cam-*` harness scenarios
exist to measure it on real hardware before committing.

**Deliberately not changed.** Measured qp on real sensor content at 2 Mbps is ~21, not the
near-lossless ~1 that synthetic content suggested, so the headroom is real but smaller
than first claimed. Changing a default that affects every rover's picture on the strength
of a webcam measurement would be overreach.

---

## 4. Client ICE configuration (`webui/src/lib/whepPlayer.js`)

**Change.** Removed the hardcoded `turn:your.turn.server:3478` with username `user` /
credential `pass`. ICE servers are now a constructor option defaulting to STUN only.

**Risk.** Low. The removed entry could never have worked — the host does not resolve and
the credentials are placeholders.

**Fallback.** The default STUN list is unchanged, and callers can now pass real ICE
servers, which was impossible before. Strictly more capable than what it replaced.

**Correction on record.** This was first reported as an ICE-stalling latency bug. Measured,
it costs nothing on loopback (173ms vs 172ms) because host candidates win immediately. It
is a correctness fix. It may cost real time on a VPS, which is where to re-test.

---

## 4b. WHEP session release on teardown (`webui/src/lib/whepPlayer.js`)

**Change.** `stop()` now DELETEs the WHEP resource URL taken from the POST's `Location` header,
using `keepalive: true`, plus a `pagehide` listener for tab close.

**Why.** `pc.close()` is local only. Measured against a real MediaMTX, a departed viewer kept
being served for **31401ms**; with the DELETE, **18ms**. At ~1.45 Mbps that is ~5.7MB of upload
per abandoned session, on a server whose upload is the binding constraint.

**Risk.** Low, and the failure mode is the status quo. If the DELETE is blocked, fails, or the
server does not return a `Location` header, the session is timed out by ICE exactly as before —
so the worst case is the behaviour that shipped previously. Every path is wrapped and swallowed;
a failed release can never surface as a playback error.

Two ordering details are load-bearing and should not be "tidied":
- `releaseSession()` runs **before** `abortController.abort()`. Reversed, the abort cancels the
  DELETE before it leaves and the fix silently does nothing.
- `keepalive: true` is required, not decorative. A plain fetch is cancelled when the document
  goes away, which is precisely the abandoned-tab case this exists to handle.

**Verified.** End to end against the VPS through real CORS: an in-page `fetch` with keepalive
returns 200 and the session drops in 18ms. MediaMTX advertises
`Access-Control-Allow-Methods: OPTIONS, GET, POST, PATCH, DELETE` and permits the `Authorization`
header, so the authenticated path works too.

**Fallback.** Revert the commit. Nothing else depends on it, and reverting restores the previous
timeout-based cleanup rather than breaking teardown.

**Not changed: the WHIP uplink in `VipAudioUploadCard`.** It closes its peer connection the same
way, but it already notifies the server through the app's own `stopMicWhip` path, and a lingering
*ingest* session wastes no server upload because the browser has stopped sending. Left alone
because it has not been measured, not because it was judged fine.

---

## 5. Receiver latency hints — measured, then rejected

**Change: none.** `playoutDelayHint = 0` is unchanged from before.

`jitterBufferTarget = 0` — the standardised successor to `playoutDelayHint`, and the knob
current Chromium actually honours — was implemented, measured, and then **removed**:

| scenario | p50 | receiver jitter buffer |
|---|---|---|
| whip | 13ms | 8.0ms |
| whip + jitterBufferTarget 0 | 13ms | 7.8ms |

Identical, inside run-to-run noise. Chromium is already at its floor and the remaining
~8ms is not reachable this way.

It was removed rather than kept because it would have been **unmeasured risk for no
measured gain**. A smaller target buffer has less slack to absorb network jitter, loopback
has no jitter to absorb, and the failure mode — freezes and audio concealment — would have
appeared only in production. The right fallback for a change that buys nothing is not to
make it.

Also tested on **audio**, where the buffer genuinely is large (~65-72ms against video's 8ms)
and there was real reason to expect room:

| | p50 | receiver jitter buffer |
|---|---|---|
| rtsp, default | 181.2ms | 71.6ms |
| rtsp, jitterBufferTarget 0 | 177.4ms | 64.6ms |

The buffer did shrink by ~7ms, but the total moved only **3.8ms — below the 5ms
significance threshold** this project applies to every other comparison. Applying that rule
consistently means declining it here too, rather than making an exception because the
mechanism is visible.

Recorded because the reasoning matters if someone reconsiders it: if a real network shows a
jitter buffer well above these figures, this becomes worth retesting *there*, with
`freezeCount` and `concealedSamples` watched.

## 6. Harness-only changes

Measurement tooling under `webrtc/`. **No production impact**; listed for completeness
because several were bugs that produced misleading results, and results already reported
were revised because of them:

- Fixed warmup sleep → MediaMTX path-readiness poll (WHIP needs ICE+DTLS, SRT does not).
- Wait for the WebRTC listener, not just the API port.
- Wait for ports to be released between runs; fail loudly on bind errors.
- Exclusive run lock — overlapping runs share fixed ports and corrupt each other.
- Per-scenario failure isolation, so one bad trial stops discarding a whole sweep.
- Guaranteed teardown, so a readiness failure stops leaking the server and publisher.
- `--clean` for orphans, anchored on the ffmpeg binary name. An earlier pattern of
  `-f rawvideo -pix_fmt rgb24 pipe:1` matched the invoking shell's own command line and
  killed it, because `pgrep -f` matches full command lines.

---

## Recommended rollout

**Step 1 is a hard prerequisite, not a precaution.** Rovers default to RTSP and there is no
automatic fallback, so a rover restarting against a server without `rtsp: yes` will not publish at
all. This ordering is the whole reason the list is ordered.

1. **Deploy the server config and confirm MediaMTX is actually listening on RTSP** — TCP 8554 for
   control plus the separate `rtpAddress`/`rtcpAddress` UDP listeners. Verify with
   `journalctl -u rover-mediamtx | grep 'started with listener'` before touching any rover.
2. Deploy the rover code to **one** rover. Confirm the Pi stats card shows `RTSP` for its streams,
   then watch `freezeCount` and `packetsLost` against a known-good rover for a while.
3. Roll out to the rest. Note this is fleet-wide-on-restart rather than opt-in per rover: the
   transport is the default, not something each rover enables.
4. Only then consider the bitrate reduction, and measure it on rover hardware first.
5. Deploy the webui change last and separately — the WHEP session release and the ICE cleanup.

**Reverting** is `transport: mpegts` on the affected path, which restores the previous behaviour
exactly. That is the deliberate fallback; the automatic one was removed on purpose, because a rover
silently running on the slow path is harder to notice than one that is visibly down.
