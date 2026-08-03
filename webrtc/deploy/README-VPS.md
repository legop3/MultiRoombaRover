# Deploying the media server to a VPS

Installs MediaMTX as a hardened systemd service configured for low-latency rover ingest and
browser egress, then lets the harness measure it over a real network.

Loopback cannot exercise jitter, packet loss, ICE over a real path, TURN, or the effect of
actual RTT. Everything measured so far is a floor; this is where the real numbers come from.

## Install

```bash
git clone https://github.com/legop3/MultiRoombaRover.git
cd MultiRoombaRover/webrtc/deploy

# See exactly what it would do first. Writes nothing, needs no root.
./install.sh --dry-run

sudo ./install.sh \
  --public-ip 203.0.113.10 \
  --public-host rover.example.com \
  --auth-url http://127.0.0.1:8080/mediamtx/auth \
  --port-base 15939
```

**`--port-base` matters if your host only grants a port range.** MediaMTX's own defaults (8889,
8189, 8554, 8000, 8001, 9000) are scattered across the port space, so a VPS with a contiguous
allocation cannot use any of them. All eight listeners are derived from one base instead.

| flag | meaning |
|---|---|
| `--port-base` | First port of a contiguous block of 8. Default 8889 reproduces MediaMTX's familiar layout. |
| `--public-ip` | VPS public IPv4. Auto-detected from the default route if omitted. **This is the only address advertised for ICE** — see below. |
| `--public-host` | DNS name used in the printed rover URLs. Not advertised for ICE. Defaults to the public IP. |
| `--auth-url` | Your node server's `/mediamtx/auth` endpoint. Default `http://127.0.0.1:8080/mediamtx/auth`. |
| `--no-auth` | **No authentication at all.** Anyone reaching the ports can publish or read. Throwaway test boxes only. |
| `--dry-run` | Print the plan, change nothing. |

Installs to `/opt/rover-media`, runs as the unprivileged `rover-media` user, service
`rover-mediamtx`. An existing config is backed up rather than overwritten, so re-running is
safe.

### Never put a DNS name in `webrtcAdditionalHosts`

Only the IP goes there. MediaMTX resolves each entry **on the server** and advertises the result
as an ICE host candidate — and on Debian the machine's own hostname resolves through `/etc/hosts`
to `127.0.1.1`, so adding the DNS name makes the server advertise a loopback candidate ahead of
the real one.

Browsers survive it, which is what makes it dangerous: WHEP playback works perfectly and hides the
problem. ffmpeg's WHIP muxer takes the first candidate only, sends STUN to `127.0.1.1`, and fails
every publish with `Connection refused`. If WHIP publishing fails while browser playback works,
check this first.

The installer no longer substitutes a hostname into the config at all, and its placeholder guard
will fail the install if one is reintroduced into the template.

**It opens no firewall rules.** That is deliberate — silently punching holes in someone's
firewall is not something an installer should do.

## Ports

Derived from `--port-base` as a contiguous block of 8. Columns show the offset and, as an
example, the result for `--port-base 15939`.

| offset | example | proto | purpose | expose to |
|---|---|---|---|---|
| base+0 | **15939** | tcp | WebRTC signalling — WHEP for viewers, WHIP for browser mic | **public** |
| base+1 | **15940** | udp | WebRTC ICE and media | **public — required** |
| base+1 | 15940 | tcp | ICE fallback for clients whose networks block UDP | public |
| base+2 | 15941 | tcp | RTSP control — low-latency rover ingest | rovers only |
| base+3 | 15942 | udp | RTSP RTP — rover ingest media | rovers only |
| base+4 | 15943 | udp | RTSP RTCP | rovers only |
| base+5 | 15944 | udp | SRT — ingest fallback for existing rovers | rovers only |
| base+6 | 15945 | tcp | API | **loopback only — do not open** |
| base+7 | 15946 | tcp | metrics | **loopback only — do not open** |

**base+1 in UDP is the one people get wrong.** It is where media actually flows. If it is
blocked, signalling succeeds, the page looks like it is connecting, and no video ever appears.
That symptom is almost always this port.

**If your host does port *forwarding* rather than just firewalling** — an external port mapped
to a different internal one — WebRTC will fail even with everything open, because ICE advertises
the port MediaMTX bound and the client cannot reach it. In that case bind directly to the
external number if possible; if not, this needs a TURN server rather than a config tweak.

The API and metrics endpoints are unauthenticated and expose stream topology and byte
counters. They are bound to loopback in the shipped config; reach them over SSH, never by
opening the port.

Example with ufw, restricting rover ingest to a known rover subnet:

```bash
sudo ufw allow 15939/tcp comment 'rover webrtc signalling'
sudo ufw allow 15940/udp comment 'rover webrtc ICE - media flows here'
sudo ufw allow 15940/tcp comment 'rover webrtc ICE tcp fallback'
sudo ufw allow from 198.51.100.0/24 to any port 15941 proto tcp comment 'rover rtsp'
sudo ufw allow from 198.51.100.0/24 to any port 15942:15943 proto udp comment 'rover rtsp rtp'
sudo ufw allow from 198.51.100.0/24 to any port 15944 proto udp comment 'rover srt fallback'
```

Authentication is the real control; restricting by source address just reduces exposure.

## Verify on the VPS

```bash
systemctl status rover-mediamtx
journalctl -u rover-mediamtx -f

# Confirm every listener bound where expected. This is worth actually reading: rtspAddress
# only governs the TCP control port, and the UDP RTP/RTCP listeners are separate.
journalctl -u rover-mediamtx | grep -E 'started with listener'

curl -s http://127.0.0.1:15945/v3/paths/list
```

## Point the rovers at it

On each rover, in `roverd.yaml`, add the RTSP URLs next to the existing SRT ones. **Leave the
SRT URLs in place** — they are the fallback, and the publishers demote to them automatically
after repeated failures.

```yaml
media:
  video:
    transport: auto
    publishUrl: srt://VPS:15944?streamid=#!::r=roomba-alpha,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
    rtspUrl: rtsp://VPS:15941/roomba-alpha
  audioCapture:
    transport: auto
    publishUrl: srt://VPS:15944?streamid=#!::r=roomba-alpha-audio,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
    rtspUrl: rtsp://VPS:15941/roomba-alpha-audio
  audioPlayback:
    transport: auto
    forwardUrl: srt://VPS:15944?streamid=#!::r=roomba-alpha-fwd,m=request&latency=10&mode=caller&transtype=live&pkt_size=1316
    rtspUrl: rtsp://VPS:15941/roomba-alpha-fwd
```

Confirm which transport each publisher actually chose — it probes rather than assumes:

```bash
journalctl -u video-publisher -n 20 | grep 'using transport'
journalctl -u audio-only-publisher -n 20 | grep 'using transport'
journalctl -u audio-forward-listener -n 20 | grep 'reading via'
```

Roll one rover at a time and watch `freezeCount` and `packetsLost` against a rover still on
SRT. Reverting is one line: `transport: mpegts`.

## Auth: a media-only box denies everything

If the VPS runs MediaMTX **without** the node server, `authMethod: http` points at an endpoint
that nothing answers, so every publish and read is denied. The symptoms:

```
WHEP POST    {"status":"error","error":"authentication error"}
RTSP ANNOUNCE  401 Unauthorized
SRT publish    Peer rejected connection - not processing further
```

The SRT one is the useful diagnostic. `videoAuthService/httpRoute.js` allows SRT publish and read
**unconditionally** when it is reached, so if SRT is also rejected the auth backend is not
answering at all, rather than answering "no".

Note what the real auth model requires, because it affects how the harness can be used against a
production server at all: WebRTC and RTSP need a `videoSessions` token minted by the node server
for a live socket, passed as the basic-auth username. SRT and `-fwd` reads are the only
unauthenticated paths. So even with the node server running, WHEP measurement needs a session
token, which means the harness would have to acquire one the way the web UI does.

For a measurement box, the pragmatic answer is an internal auth method restricted to the
measuring machine's address:

```yaml
# /opt/rover-media/mediamtx.yml - measurement only, NOT for a server carrying real rovers
authMethod: internal
authInternalUsers:
  - user: any
    pass:
    # BOTH addresses are needed, and missing either one looks like a different fault:
    #   127.0.0.1  the API, because it is reached through an SSH tunnel and therefore
    #              arrives on loopback rather than from the measuring machine's address
    #   the public the media traffic, which does arrive from the measuring machine
    ips: ['127.0.0.1', '::1', '203.0.113.55']
    permissions:
      - action: publish
      - action: read
      - action: api
      - action: metrics
```

Two things that are easy to get wrong here, both learned by getting them wrong:

- **`authMethod: internal` drops `authHTTPExclude`.** The shipped `http` config excludes `api`,
  `metrics`, and `pprof` from auth, so the API is reachable without credentials. Switching to
  `internal` removes that exclusion, and the API starts returning
  `401 Www-Authenticate: Basic realm="mediamtx"`. The `api` and `metrics` permissions above are
  what restore it.
- **The tunnel changes the source address.** An allowlist containing only the measuring machine's
  public IP will still 401 the API, because the tunnel presents it as loopback.

`user: any` with an empty `pass` means no credentials are required *from an allowed address*, so
`ips` is the entire access control. Without it this is an open relay anyone can publish to.
Restore `authMethod: http` before the box carries anything real.

## Measure it remotely

```bash
MEDIA_HOST=rover.example.com \
MEDIA_WEBRTC_PORT=15939 MEDIA_RTSP_PORT=15941 MEDIA_SRT_PORT=15944 MEDIA_API_PORT=15945 \
  node webrtc/harness/measure.js baseline
```

Every port has an override, so a non-default `--port-base` needs no code change:
`MEDIA_WEBRTC_PORT`, `MEDIA_RTSP_PORT`, `MEDIA_SRT_PORT`, `MEDIA_API_PORT`, and
`MEDIA_ICE_UDP_PORT` (only used when the harness manages a local server).

`MEDIA_HOST` switches every probe to the remote server. Because the target is remote, the
harness **measures without starting or stopping anything** — it will not touch a deployed
service. Override with `MEDIA_MANAGED=1` only if you genuinely want it managing a remote
server.

The API is on loopback, and the harness needs it to know when a path is ready. Tunnel it:

```bash
ssh -N -L 15945:127.0.0.1:15945 user@rover.example.com &
MEDIA_HOST=rover.example.com MEDIA_API_PORT=15945 \
MEDIA_WEBRTC_PORT=15939 MEDIA_RTSP_PORT=15941 MEDIA_SRT_PORT=15944 \
  node webrtc/harness/measure.js baseline
```

### If WHEP returns 400 "error getting local interfaces"

```
WHEP 400 {"status":"error","error":"error getting local interfaces:
          route ip+net: netlinkrib: address family not supported by protocol"}
```

**This is almost always the systemd sandbox, not the network.** Go's `net.Interfaces()` opens an
`AF_NETLINK` socket to enumerate addresses, which pion needs to gather ICE candidates. If the unit
restricts address families without including `AF_NETLINK`, systemd denies the socket, Go reports
EAFNOSUPPORT, and MediaMTX surfaces it as a client-facing HTTP 400 naming network interfaces —
three layers from the cause.

```bash
sudo sed -i 's|^RestrictAddressFamilies=.*|RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK|' \
  /etc/systemd/system/rover-mediamtx.service
sudo systemctl daemon-reload && sudo systemctl restart rover-mediamtx
```

Installs from before this fix need that edit; the shipped unit now includes `AF_NETLINK`.

Note `webrtcIPsFromInterfaces: no` does **not** fix this, which is worth knowing because it looks
like it should. That flag controls whether enumerated addresses are *advertised* as candidates, not
whether the enumeration happens at all — the netlink call runs regardless. It is still the right
setting on a VPS, because `webrtcAdditionalHosts` already states the reachable address and an
enumerated private one would be useless to clients, but it is a separate concern.

### What to expect to be different, and why it matters

Local numbers are a floor. Over a real network, watch for:

- **RTT added directly.** Roughly half the ping shows up in one-way latency.
- **A larger receiver jitter buffer.** Locally it sits at ~8ms for video and ~65ms for audio
  because there is no jitter to absorb. Real jitter will raise it, and it is the largest
  controllable term. This is where `jitterBufferTarget` becomes worth retesting — it was
  measured and rejected locally precisely because there was nothing for it to reclaim.
- **Loss, and therefore the RTSP/UDP tradeoff.** RTSP/UDP has no retransmission and no
  keyframe request. If `freezeCount` or `packetsLost` are non-zero, that is the argument for
  WHIP (which has NACK/RTX and PLI) rather than for shortening the GOP.
- **Whether the placeholder TURN removal mattered.** It cost nothing measurable on loopback
  because host candidates win instantly. On a real path, ICE gathering against an unreachable
  server is real time.
- **Egress under concurrency.** Per-viewer egress is what the upload budget is spent on, and
  the local figure is per single viewer. Run several probes at once to see the real cost.

## Uninstall

```bash
sudo systemctl disable --now rover-mediamtx
sudo rm /etc/systemd/system/rover-mediamtx.service
sudo systemctl daemon-reload
sudo rm -rf /opt/rover-media
sudo userdel rover-media
```
