// Latency Harness Browser Audio Probe
// Purpose: Detects tone-burst onsets in a WHEP audio track and times them against the emission grid.
// Scope: Browser-side only; the marker grid is defined by lib/audioSource.js.

/*
  Audio latency is measured by onset timing rather than by an embedded code, because
  a waveform has nowhere to hide a payload that Opus will not alter. The source emits
  a short 1kHz burst on a fixed grid; this probe notes when each burst is audible and
  subtracts the grid time.

  Detection runs in an AudioWorklet rather than an AnalyserNode polled from the main
  thread. The worklet sees every 128-sample render quantum on the audio thread, so an
  onset is timed to within ~3ms at 48kHz. A main-thread poll would be at the mercy of
  task scheduling and would add jitter larger than some of the differences being
  measured.
*/
function installAudioProbe() {
  window.__audioProbe = {
    onsets: [],
    events: [],
    status: 'idle',
    connectStartedAt: null,
    contextSampleRate: null,
  };

  function note(event, detail) {
    window.__audioProbe.events.push({ at: Date.now(), event, detail: detail ?? null });
  }

  const WORKLET_SOURCE = `
    class OnsetDetector extends AudioWorkletProcessor {
      constructor() {
        super();
        this.envelope = 0;
        this.aboveSince = null;
        this.armed = true;
        this.samplesSeen = 0;
      }
      process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel) return true;
        for (let i = 0; i < channel.length; i += 1) {
          const magnitude = Math.abs(channel[i]);
          // One-pole follower. Fast attack so an onset is not smeared late, slow
          // release so the tail of a burst cannot retrigger as a second onset.
          const coefficient = magnitude > this.envelope ? 0.45 : 0.002;
          this.envelope += (magnitude - this.envelope) * coefficient;

          const loud = this.envelope > 0.06;
          if (loud && this.armed) {
            this.armed = false;
            // currentTime is the audio thread's own clock at the start of this
            // quantum, so the reported time is independent of main-thread delay.
            this.port.postMessage({
              audioTime: currentTime + (i / sampleRate),
            });
          } else if (!loud && !this.armed && this.envelope < 0.015) {
            this.armed = true;
          }
        }
        this.samplesSeen += channel.length;
        return true;
      }
    }
    registerProcessor('onset-detector', OnsetDetector);
  `;

  window.__startAudioProbe = async function startAudioProbe(options) {
    const { whepUrl, epochMs, markerIntervalMs, sourceStartOffsetMs, iceServers, playoutDelayHint, jitterBufferTarget = null } = options;
    const probe = window.__audioProbe;
    probe.status = 'connecting';
    probe.connectStartedAt = Date.now();

    const pc = new RTCPeerConnection({
      iceServers: iceServers || [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    window.__audioPc = pc;

    // latencyHint 'interactive' asks for the smallest output buffer the platform
    // will give. Without it Chromium picks a larger buffer that would show up as
    // pipeline latency the pipeline is not responsible for.
    /*
      Audio is where the jitter buffer actually dominates: measured ~62ms of a ~183ms total,
      against ~8ms for video. jitterBufferTarget did nothing for video because Chromium was
      already at its floor there, but with an audio buffer this large there may be real room.
      Wrapped because a rejected hint must never stop playback.
    */
    function applyAudioLatencyHints(receiver) {
      if (!receiver) return;
      try {
        if (playoutDelayHint !== null && 'playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = playoutDelayHint;
        }
      } catch { /* optimisation only */ }
      try {
        if (jitterBufferTarget !== null && 'jitterBufferTarget' in receiver) {
          receiver.jitterBufferTarget = jitterBufferTarget;
        }
      } catch { /* optimisation only */ }
    }

    const audioContext = new AudioContext({ latencyHint: 'interactive' });
    probe.contextSampleRate = audioContext.sampleRate;

    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    await audioContext.audioWorklet.addModule(workletUrl);

    const stream = new MediaStream();
    pc.ontrack = (event) => {
      note('track', event.track.kind);
      if (event.track.kind !== 'audio') return;
      stream.addTrack(event.track);
      applyAudioLatencyHints(event.receiver);
    };
    pc.onconnectionstatechange = () => {
      note('connectionState', pc.connectionState);
      probe.status = pc.connectionState;
    };

    pc.addTransceiver('audio', { direction: 'recvonly' });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!response.ok) {
      probe.status = 'error';
      const body = await response.text().catch(() => '');
      throw new Error(`WHEP ${response.status}: ${body.slice(0, 200)}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    note('answerApplied');

    pc.getReceivers().forEach(applyAudioLatencyHints);

    /*
      A MediaStreamAudioSourceNode needs the track attached to a media element in
      some Chromium versions before it produces samples. Keeping a muted sink
      element alive avoids a silent graph, and muting it keeps the harness from
      needing an audio device at all.
    */
    const sink = document.createElement('audio');
    sink.srcObject = stream;
    sink.muted = true;
    sink.autoplay = true;
    document.body.appendChild(sink);
    await sink.play().catch((err) => note('sinkPlayRejected', String(err)));

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const detector = new AudioWorkletNode(audioContext, 'onset-detector');
    sourceNode.connect(detector);
    // Terminating into a zero-gain node keeps the graph pulling without emitting
    // sound, which a headless container has no device for anyway.
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    detector.connect(mute).connect(audioContext.destination);

    /*
      Maps an audio-thread timestamp to wall clock. outputLatency and baseLatency are
      the context's own accounting for buffering it adds after the worklet sees the
      samples, so they belong in the total: a listener hears the burst that much
      later than the worklet detected it.
    */
    function audioTimeToWallMs(audioTime) {
      const contextNow = audioContext.currentTime;
      const outputLatency = (audioContext.outputLatency || 0) + (audioContext.baseLatency || 0);
      return Date.now() - (contextNow - audioTime) * 1000 + outputLatency * 1000;
    }

    detector.port.onmessage = (event) => {
      const heardAtWallMs = audioTimeToWallMs(event.data.audioTime);
      const heardSinceEpoch = heardAtWallMs - epochMs;
      /*
        Attribute the onset to the nearest grid slot at or before it. Latency above
        half the grid interval would alias onto the wrong burst, so the reported
        value is flagged rather than silently wrong.
      */
      const slot = Math.floor((heardSinceEpoch - sourceStartOffsetMs) / markerIntervalMs);
      const expectedAt = sourceStartOffsetMs + slot * markerIntervalMs;
      const latencyMs = heardSinceEpoch - expectedAt;
      probe.onsets.push({
        latencyMs: Math.round(latencyMs * 10) / 10,
        slot,
        at: Date.now(),
        ambiguous: latencyMs > markerIntervalMs / 2,
      });
    };

    await audioContext.resume();
    probe.status = 'running';
    return true;
  };

  window.__collectAudioStats = async function collectAudioStats() {
    const pc = window.__audioPc;
    if (!pc) return null;
    const report = await pc.getStats();
    let inbound = null;
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') {
        inbound = {
          packetsReceived: entry.packetsReceived,
          packetsLost: entry.packetsLost,
          jitter: entry.jitter,
          jitterBufferDelay: entry.jitterBufferDelay,
          jitterBufferEmittedCount: entry.jitterBufferEmittedCount,
          jitterBufferTargetDelay: entry.jitterBufferTargetDelay,
          concealedSamples: entry.concealedSamples,
          totalSamplesReceived: entry.totalSamplesReceived,
          insertedSamplesForDeceleration: entry.insertedSamplesForDeceleration,
          removedSamplesForAcceleration: entry.removedSamplesForAcceleration,
          bytesReceived: entry.bytesReceived,
        };
      }
    });
    return inbound;
  };
}

module.exports = { installAudioProbe };
