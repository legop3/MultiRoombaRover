// Latency Harness Stack
// Purpose: Starts and stops the media server the probes measure through.
// Scope: Process lifecycle and readiness only; no measurement logic.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const REPO_WEBRTC_DIR = path.resolve(__dirname, '..', '..');
const MEDIAMTX_BIN = path.join(REPO_WEBRTC_DIR, 'vendor', 'mediamtx');

/*
  Where the media server lives, and which ports it uses.

  Local runs start their own MediaMTX on loopback with the harness's own non-default ports.
  Pointing MEDIA_HOST at a deployed server switches every URL builder to it, so the same probes
  measure a real network instead of loopback - which is the whole point of the VPS step, since
  loopback cannot exercise jitter, loss, ICE over a real path, or TURN.

  A remote target implies the harness must NOT start or stop a server. That is controlled by
  MEDIA_MANAGED, which defaults to false whenever MEDIA_HOST is set to anything but loopback:
  killing someone's deployed media server because a local default leaked would be a bad
  surprise.
*/
const MEDIA_HOST = process.env.MEDIA_HOST || '127.0.0.1';
/*
  The API host is separate from the media host on purpose.

  MediaMTX's API is bound to loopback on a deployed server, so it is reached through an SSH
  tunnel while media goes to the public address. Deriving the API URL from MEDIA_HOST would send
  it to a port that is deliberately not exposed, and the harness would fail waiting for a path
  that was actually fine.

    ssh -N -L 15945:127.0.0.1:15945 vps
    MEDIA_HOST=vps.example.com MEDIA_API_HOST=127.0.0.1 MEDIA_API_PORT=15945 ...
*/
const MEDIA_API_HOST = process.env.MEDIA_API_HOST || MEDIA_HOST;
const IS_REMOTE = !['127.0.0.1', 'localhost', '::1'].includes(MEDIA_HOST);
const MEDIA_MANAGED = process.env.MEDIA_MANAGED
  ? process.env.MEDIA_MANAGED === '1'
  : !IS_REMOTE;

// Deployed servers use MediaMTX's defaults; the local harness deliberately does not, so it
// cannot collide with a real server or with whatever else holds :9000 on a workstation.
const PORTS = IS_REMOTE
  ? {
    api: Number(process.env.MEDIA_API_PORT || 9997),
    webrtc: Number(process.env.MEDIA_WEBRTC_PORT || 8889),
    srt: Number(process.env.MEDIA_SRT_PORT || 9000),
    rtsp: Number(process.env.MEDIA_RTSP_PORT || 8554),
  }
  : {
    api: Number(process.env.MEDIA_API_PORT || 9987),
    webrtc: Number(process.env.MEDIA_WEBRTC_PORT || 8899),
    srt: Number(process.env.MEDIA_SRT_PORT || 9890),
    rtsp: Number(process.env.MEDIA_RTSP_PORT || 8554),
  };

function mediaTarget() {
  return { host: MEDIA_HOST, apiHost: MEDIA_API_HOST, isRemote: IS_REMOTE, managed: MEDIA_MANAGED, ports: PORTS };
}

function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

/*
  Resolves once nothing answers on the port. Starting a new MediaMTX while the previous
  one is still shutting down is the subtle version of this bug: the new process fails
  to bind and logs "address already in use", but the readiness probe succeeds against
  the *dying* instance, so the harness proceeds and the publisher ends up talking to a
  server that is about to disappear. The path then never becomes ready and it looks
  like a publisher fault.
*/
/*
  Interrupting a run orphans MediaMTX and the capture ffmpeg, and the next run then
  fails on a busy port or a busy /dev/video0. Cleanup is offered explicitly via
  `--clean` rather than done implicitly on every start, because killing processes by
  pattern is not something a measurement tool should do behind the operator's back.

  The match is deliberately narrow: only processes whose command line contains this
  checkout's own vendor path, or the capture pipeline this harness constructs. A
  MediaMTX the operator is running from somewhere else is left alone.
*/
/*
  The harness binds fixed ports, so two runs can never coexist: they fight over the
  API, the WebRTC listener, and the single WebRTC UDP port, and the symptom is a
  publisher whose path never becomes ready - which looks like a pipeline fault.

  This bit me directly. A wait-loop that treated a failed run as "finished" started the
  next run while the previous one was still measuring, and several results had to be
  thrown away. An exclusive lock makes that mistake impossible rather than merely
  discouraged.
*/
function acquireRunLock() {
  const lockPath = path.join(REPO_WEBRTC_DIR, 'results', '.run.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    // wx fails if the file exists, which is the atomic part.
    handle = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const owner = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = Number(owner.split(' ')[0]);
    // A stale lock from a killed run should not block forever.
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      throw new Error(
        `Another harness run is active (${owner}). The harness uses fixed ports, so runs `
        + 'cannot overlap - wait for it, or stop it first.',
      );
    }
    fs.rmSync(lockPath, { force: true });
    handle = fs.openSync(lockPath, 'wx');
  }
  fs.writeFileSync(handle, `${process.pid} started ${new Date().toISOString()}\n`);
  fs.closeSync(handle);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    fs.rmSync(lockPath, { force: true });
  };
  // Covers ctrl-c and kill as well as normal exit, so a killed run does not leave a
  // lock that the next one has to reason about.
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });
  return release;
}

function harnessOrphanPatterns() {
  return [
    path.join(REPO_WEBRTC_DIR, 'vendor', 'mediamtx'),
    path.join(REPO_WEBRTC_DIR, 'vendor', 'browsers'),
    /*
      The capture pipeline this harness builds. Anchored on the ffmpeg binary name so
      the pattern cannot match a shell whose command line merely mentions these flags -
      pgrep -f matches full command lines, and a pattern like "-f rawvideo -pix_fmt
      rgb24 pipe:1" on its own will happily match the very shell that invoked it and
      kill it. That is not hypothetical; it happened while developing this.
    */
    'ffmpeg -hide_banner -loglevel warning -fflags nobuffer -flags low_delay -f v4l2',
  ];
}

function killHarnessOrphans({ onLog } = {}) {
  const { execFileSync } = require('child_process');
  let killed = 0;
  for (const pattern of harnessOrphanPatterns()) {
    try {
      const output = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      output.split('\n').map((line) => line.trim()).filter(Boolean).forEach((pid) => {
        try {
          process.kill(Number(pid), 'SIGKILL');
          killed += 1;
          onLog?.(`killed orphan pid ${pid} (${pattern})`);
        } catch {
          // Already gone, or not ours to signal.
        }
      });
    } catch {
      // pgrep exits non-zero when nothing matches, which is the normal case.
    }
  }
  return killed;
}

/*
  Waits for a UDP port to be bindable.

  The HTTP check below only proves the API's TCP port was released. WebRTC ICE lives on a UDP
  port, and a shutting-down MediaMTX can release TCP while still holding UDP - which showed up
  as WHIP failing whenever it followed another trial, while WHIP on its own always passed. TCP
  readiness was simply the wrong thing to wait for.

  A bind attempt is the only reliable test: there is no HTTP endpoint that can answer for a UDP
  socket.
*/
function waitForUdpPortFree(port, timeoutMs = 10_000) {
  const dgram = require('dgram');
  const deadline = Date.now() + timeoutMs;

  const attempt = () => new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    socket.once('error', (err) => {
      socket.close(() => {});
      if (err.code === 'EADDRINUSE') {
        if (Date.now() > deadline) {
          reject(new Error(`UDP port ${port} still in use after ${timeoutMs}ms`));
          return;
        }
        setTimeout(() => attempt().then(resolve, reject), 150);
        return;
      }
      // Anything else means we cannot test it; do not block the run on that.
      resolve();
    });
    socket.once('listening', () => socket.close(() => resolve()));
    socket.bind(port);
  });

  return attempt();
}

function waitForPortFree(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (Date.now() > deadline) {
          reject(new Error(
            `Port still in use: ${url}\n`
            + 'A MediaMTX from an interrupted run is probably still holding it. '
            + 'Re-run with --clean to kill harness-owned orphans, or stop it yourself.',
          ));
          return;
        }
        setTimeout(attempt, 150);
      });
      request.on('error', () => resolve());
    };
    attempt();
  });
}

/*
  MediaMTX is started per run rather than left running between runs. A fresh
  process guarantees no path state, no lingering reader, and no accumulated
  queue from a previous measurement leaks into the next one.
*/
/*
  Resolves once the listener answers at all, whatever it answers with. A 404 from the
  WebRTC endpoint is proof the listener is bound and routing, which is exactly what a
  publisher needs; waiting for a 2xx would mean waiting for a stream that does not
  exist yet.
*/
function waitForListener(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for listener ${url}`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function startMediaMtx({
  configPath,
  apiUrl = `http://${MEDIA_API_HOST}:${PORTS.api}/v3/config/global/get`,
  webrtcProbeUrl = `http://${MEDIA_HOST}:${PORTS.webrtc}/does-not-exist/whep`,
  // The harness configs put ICE on 8289; production uses 8189. Only meaningful for a locally
  // managed server, since a remote one is never started or stopped here.
  iceUdpPort = Number(process.env.MEDIA_ICE_UDP_PORT || 8289),
  onLog,
}) {
  /*
    Against a remote server the harness measures but never manages. Returning a no-op handle
    keeps every caller's start/stop structure intact without it being able to touch a deployed
    service.
  */
  if (!MEDIA_MANAGED) {
    await waitForHttp(apiUrl).catch(() => {
      throw new Error(
        `No MediaMTX API at ${apiUrl}. For a remote target, check the host, that port ${PORTS.api} `
        + 'is reachable, and that the API is bound somewhere this machine can see.',
      );
    });
    return { process: null, logLines: [], remote: true, async stop() {} };
  }

  // Never race a previous instance's shutdown, on either transport.
  await waitForPortFree(apiUrl);
  await waitForUdpPortFree(iceUdpPort).catch((err) => {
    throw new Error(`${err.message}. A previous MediaMTX is still holding the WebRTC ICE port.`);
  });

  const proc = spawn(MEDIAMTX_BIN, [configPath], {
    cwd: REPO_WEBRTC_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logLines = [];
  let bindFailure = null;
  const capture = (chunk) => {
    const text = chunk.toString();
    logLines.push(text);
    /*
      A bind failure must fail the run loudly and immediately. Left undetected it
      produces a confusing downstream symptom - a publisher that connects but whose
      path never becomes ready - several seconds later and in a different component.
    */
    if (/address already in use|bind:/i.test(text)) {
      bindFailure = text.trim().split('\n').find((line) => /address already in use|bind:/i.test(line)) || text.trim();
    }
    onLog?.(text);
  };
  proc.stdout.on('data', capture);
  proc.stderr.on('data', capture);

  let exited = null;
  proc.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  try {
    await waitForHttp(apiUrl);
    /*
      The API answering does not mean the WebRTC listener is bound yet, and they come
      up independently. Starting a WHIP publisher into a listener that is not yet
      accepting makes ffmpeg fail its DTLS handshake immediately with "Could not write
      header (incorrect codec parameters ?)", which reads like an encoder problem and
      is not one. SRT hid this race because it happens to bind earlier.
    */
    await waitForListener(webrtcProbeUrl);
    if (bindFailure) throw new Error(bindFailure);
  } catch (err) {
    const tail = logLines.join('').split('\n').slice(-12).join('\n');
    proc.kill('SIGKILL');
    throw new Error(`MediaMTX did not become ready: ${err.message}\n${tail}`);
  }

  if (bindFailure) {
    proc.kill('SIGKILL');
    throw new Error(`MediaMTX could not bind: ${bindFailure}`);
  }

  if (exited) {
    throw new Error(`MediaMTX exited immediately (code ${exited.code}): ${logLines.join('')}`);
  }

  return {
    process: proc,
    logLines,
    async stop() {
      if (!exited) {
        proc.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve();
          }, 3000);
          proc.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      /*
        Process exit is not the same as the sockets being reusable. Waiting for the
        port to actually stop answering is what makes back-to-back trials in a sweep
        reliable, which is why the third trial used to fail regardless of its settings.
      */
      await waitForPortFree(apiUrl).catch(() => {});
      // The ICE port is the one that actually gated back-to-back WHIP trials.
      await waitForUdpPortFree(iceUdpPort).catch(() => {});
    },
  };
}

/*
  Waits until MediaMTX reports the path has a publisher and is ready to be read.

  This replaces a fixed warmup sleep, which was a real source of flakiness: SRT
  connects almost immediately but WHIP has to complete ICE and a DTLS handshake
  first, so a sleep long enough for one is not reliably long enough for the other. A
  run that attached the browser too early failed with "no stream is available" and
  looked like a pipeline fault rather than a harness race.
*/
async function waitForPathReady({ apiBase = `http://${MEDIA_API_HOST}:${PORTS.api}`, pathName, timeoutMs = 20_000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';
  while (Date.now() < deadline) {
    const state = await new Promise((resolve) => {
      const request = http.get(`${apiBase}/v3/paths/get/${encodeURIComponent(pathName)}`, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) return resolve(`http ${response.statusCode}`);
          try {
            const parsed = JSON.parse(body);
            return resolve(parsed.ready === true ? 'ready' : `ready=${parsed.ready}`);
          } catch {
            return resolve('unparseable');
          }
        });
      });
      request.on('error', (err) => resolve(`error ${err.code || err.message}`));
    });
    if (state === 'ready') return true;
    lastState = state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Path "${pathName}" never became ready (last state: ${lastState})`);
}

function srtPublishUrl({ host = MEDIA_HOST, port = PORTS.srt, streamId, latency = 10 }) {
  /*
    Byte-for-byte the shape used in roverd.sample.yaml, including the `#!::` stream
    id syntax and latency=10. Getting this wrong would measure a different transport
    configuration than the rovers actually run.
  */
  return `srt://${host}:${port}?streamid=#!::r=${streamId},m=publish&latency=${latency}&mode=caller&transtype=live&pkt_size=1316`;
}

function srtReadUrl({ host = MEDIA_HOST, port = PORTS.srt, streamId, latency = 10 }) {
  return `srt://${host}:${port}?streamid=#!::r=${streamId},m=request&latency=${latency}&mode=caller&transtype=live&pkt_size=1316`;
}

function rtspPublishUrl({ host = MEDIA_HOST, port = PORTS.rtsp, streamId }) {
  return `rtsp://${host}:${port}/${streamId}`;
}

// Read side of RTSP, for measuring how the rover consumes forwarded audio.
function rtspReadUrl({ host = MEDIA_HOST, port = PORTS.rtsp, streamId }) {
  return `rtsp://${host}:${port}/${streamId}`;
}

function whepUrl({ host = MEDIA_HOST, port = PORTS.webrtc, streamId }) {
  return `http://${host}:${port}/${streamId}/whep`;
}

function whipUrl({ host = MEDIA_HOST, port = PORTS.webrtc, streamId }) {
  return `http://${host}:${port}/${streamId}/whip`;
}

/*
  ffmpeg's whip muxer takes the endpoint as the output URL. MediaMTX serves WHIP on
  the same listener as WHEP, so no extra config is needed to accept it.
*/
function whipPublishUrl({ host = MEDIA_HOST, port = PORTS.webrtc, streamId }) {
  return `http://${host}:${port}/${streamId}/whip`;
}

module.exports = {
  MEDIAMTX_BIN,
  REPO_WEBRTC_DIR,
  startMediaMtx,
  srtPublishUrl,
  srtReadUrl,
  rtspPublishUrl,
  rtspReadUrl,
  whepUrl,
  whipUrl,
  whipPublishUrl,
  waitForHttp,
  waitForListener,
  waitForPortFree,
  waitForUdpPortFree,
  waitForPathReady,
  killHarnessOrphans,
  mediaTarget,
  acquireRunLock,
};
