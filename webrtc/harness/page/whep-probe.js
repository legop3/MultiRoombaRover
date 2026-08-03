// Latency Harness Browser Probe
// Purpose: Runs inside headless Chromium, plays a WHEP stream, and decodes the in-band timecode from rendered frames.
// Scope: Browser-side only. Injected as a page function; the node runner owns configuration and reporting.

/*
  This is the measurement that matters. Everything before it can be inferred from
  logs and metrics, but only a real browser tells you how long a frame actually
  takes to become visible, because the receiver jitter buffer and the decoder are
  where WebRTC latency usually hides.

  Frames are read with requestVideoFrameCallback rather than a timer. That callback
  fires once per frame the compositor actually presents, and it hands over the
  frame's presentation metadata, so a sample is tied to a real presented frame
  instead of to whenever a polling loop happened to run.
*/
function installWhepProbe() {
  window.__probe = {
    samples: [],
    events: [],
    status: 'idle',
    connectStartedAt: null,
    firstFrameAt: null,
    stats: null,
    resourceUrl: null,
  };

  /*
    Ends the session server-side. Mirrors whepPlayer.releaseSession() so the harness tears down
    the way the shipped client does, rather than measuring a path production does not take.
  */
  window.__releaseWhepSession = async function releaseWhepSession() {
    const resourceUrl = window.__probe.resourceUrl;
    window.__probe.resourceUrl = null;
    if (!resourceUrl) return null;
    try {
      const response = await fetch(resourceUrl, { method: 'DELETE', keepalive: true });
      return response.status;
    } catch (err) {
      return `threw: ${err.message}`;
    }
  };

  function note(event, detail) {
    window.__probe.events.push({ at: Date.now(), event, detail: detail ?? null });
  }

  function decodeTimecodeFromImageData(data, frameWidth, spec) {
    const { CELL_PX, DATA_BITS, MARKER_CELLS, SAMPLE_INSET, LUMA_THRESHOLD } = spec;
    const cellsPerRow = Math.floor(frameWidth / CELL_PX);
    if (cellsPerRow < 1) return null;

    const lumaAt = (index) => {
      const x = (index % cellsPerRow) * CELL_PX + SAMPLE_INSET;
      const y = Math.floor(index / cellsPerRow) * CELL_PX + SAMPLE_INSET;
      // RGBA. The generator paints grey, so red alone is the luma.
      return data[(y * frameWidth + x) * 4];
    };

    for (let cell = 0; cell < MARKER_CELLS; cell += 1) {
      if (!(lumaAt(cell) > LUMA_THRESHOLD)) return null;
    }
    let value = 0;
    for (let bit = 0; bit < DATA_BITS; bit += 1) {
      const luma = lumaAt(MARKER_CELLS + bit);
      if (typeof luma !== 'number' || Number.isNaN(luma)) return null;
      value = (value << 1) | (luma > LUMA_THRESHOLD ? 1 : 0);
    }
    return value >>> 0;
  }

  window.__startProbe = async function startProbe(options) {
    const { whepUrl, epochMs, spec, iceServers, playoutDelayHint, jitterBufferTarget = null, width, height } = options;
    const probe = window.__probe;
    probe.status = 'connecting';
    probe.connectStartedAt = Date.now();

    const video = document.createElement('video');
    video.playsInline = true;
    video.autoplay = true;
    video.muted = true;
    document.body.appendChild(video);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // willReadFrequently keeps getImageData on the CPU path. Without it Chromium
    // may keep the canvas GPU-backed and every read becomes a stalling readback,
    // which would add latency to the measurement itself.
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const pc = new RTCPeerConnection({
      iceServers: iceServers || [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    window.__pc = pc;

    /*
      playoutDelayHint is the older, non-standard knob; jitterBufferTarget is the
      standardised replacement and in current Chromium it is the one that actually
      moves the receiver's target buffer. Both are set because which one a given
      browser honours varies, and the remaining latency budget after the container
      fix is dominated by exactly this buffer.
    */
    function applyReceiverLatencyHints(receiver) {
      if (!receiver) return;
      if (playoutDelayHint !== null && 'playoutDelayHint' in receiver) {
        receiver.playoutDelayHint = playoutDelayHint;
      }
      if (jitterBufferTarget !== null && 'jitterBufferTarget' in receiver) {
        try {
          receiver.jitterBufferTarget = jitterBufferTarget;
        } catch (err) {
          note('jitterBufferTargetRejected', String(err));
        }
      }
    }

    const stream = new MediaStream();
    pc.ontrack = (event) => {
      note('track', event.track.kind);
      event.streams[0]?.getTracks().forEach((track) => stream.addTrack(track));
      video.srcObject = stream;
      applyReceiverLatencyHints(event.receiver);
    };
    pc.oniceconnectionstatechange = () => note('iceConnectionState', pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      note('connectionState', pc.connectionState);
      probe.status = pc.connectionState;
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    note('offerCreated');

    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      probe.status = 'error';
      throw new Error(`WHEP ${response.status}: ${body.slice(0, 200)}`);
    }
    /*
      The WHEP resource URL, kept so the probe can end its session server-side.

      Without this the probe leaks exactly as the production player did: MediaMTX keeps sending
      to a closed page for ~31s. That is not merely untidy in a measurement harness - it
      corrupts any concurrency measurement, because the previous step's departed viewers are
      still being served during the next step's window. The first concurrency ladder run
      reported 12 live sessions during its 8-viewer step for this reason.
    */
    const location = response.headers.get('location');
    if (location) {
      try {
        window.__probe.resourceUrl = new URL(location, whepUrl).href;
      } catch {
        window.__probe.resourceUrl = null;
      }
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    note('answerApplied');

    pc.getReceivers().forEach(applyReceiverLatencyHints);

    await video.play().catch((err) => note('playRejected', String(err)));

    let lastTimecode = null;

    function onFrame(now, metadata) {
      if (video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        context.drawImage(video, 0, 0);
        const spec2 = spec;
        const rows = Math.ceil(spec2.TOTAL_CELLS / Math.floor(canvas.width / spec2.CELL_PX));
        const stripHeight = rows * spec2.CELL_PX;
        // Only the strip is read back. Reading the whole frame would cost far more
        // than the measurement can afford at 30fps.
        const imageData = context.getImageData(0, 0, canvas.width, stripHeight);
        const timecode = decodeTimecodeFromImageData(imageData.data, canvas.width, spec2);

        if (timecode !== null && timecode !== lastTimecode) {
          lastTimecode = timecode;
          const arrivedAt = Date.now();
          if (probe.firstFrameAt === null) {
            probe.firstFrameAt = arrivedAt;
            note('firstDecodedFrame', arrivedAt - probe.connectStartedAt);
          }
          /*
            expectedDisplayTime is the compositor's own estimate of when this frame
            reaches the screen. Using it where available makes the number glass to
            glass rather than glass to javascript.
          */
          const presentedAt = metadata && metadata.expectedDisplayTime
            ? performance.timeOrigin + metadata.expectedDisplayTime
            : arrivedAt;
          probe.samples.push({
            timecode,
            at: arrivedAt,
            latencyMs: (arrivedAt - epochMs) - timecode,
            presentedLatencyMs: (presentedAt - epochMs) - timecode,
            processingDurationMs: metadata?.processingDuration != null
              ? Math.round(metadata.processingDuration * 1000 * 10) / 10
              : null,
          });
        }
      }
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(onFrame);
      }
    }

    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(onFrame);
    } else {
      note('noRequestVideoFrameCallback');
      setInterval(() => onFrame(performance.now(), null), 8);
    }

    probe.status = 'running';
    return true;
  };

  /*
    getStats supplies the quality half of the picture. Latency alone is a trap: any
    of these knobs can be pushed until the video is a blocky mess, so QP and freeze
    counts are collected next to the timing and reported together.
  */
  window.__collectStats = async function collectStats() {
    const pc = window.__pc;
    if (!pc) return null;
    const report = await pc.getStats();
    const out = { inboundVideo: null, inboundAudio: null, candidatePair: null };
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') {
        out.inboundVideo = {
          framesDecoded: entry.framesDecoded,
          framesDropped: entry.framesDropped,
          framesReceived: entry.framesReceived,
          freezeCount: entry.freezeCount,
          totalFreezesDuration: entry.totalFreezesDuration,
          jitterBufferDelay: entry.jitterBufferDelay,
          jitterBufferEmittedCount: entry.jitterBufferEmittedCount,
          jitter: entry.jitter,
          packetsLost: entry.packetsLost,
          packetsReceived: entry.packetsReceived,
          bytesReceived: entry.bytesReceived,
          qpSum: entry.qpSum,
          totalDecodeTime: entry.totalDecodeTime,
          totalProcessingDelay: entry.totalProcessingDelay,
          totalAssemblyTime: entry.totalAssemblyTime,
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
          framesPerSecond: entry.framesPerSecond,
        };
      }
      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') {
        out.inboundAudio = {
          packetsReceived: entry.packetsReceived,
          packetsLost: entry.packetsLost,
          jitter: entry.jitter,
          jitterBufferDelay: entry.jitterBufferDelay,
          jitterBufferEmittedCount: entry.jitterBufferEmittedCount,
          concealedSamples: entry.concealedSamples,
          totalSamplesReceived: entry.totalSamplesReceived,
        };
      }
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) {
        out.candidatePair = {
          currentRoundTripTime: entry.currentRoundTripTime,
          availableIncomingBitrate: entry.availableIncomingBitrate,
        };
      }
    });
    window.__probe.stats = out;
    return out;
  };
}

module.exports = { installWhepProbe };
