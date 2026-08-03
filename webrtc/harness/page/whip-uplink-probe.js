// Latency Harness Browser WHIP Uplink Probe
// Purpose: Publishes timestamped tone bursts from the browser via WHIP, the push-to-talk direction.
// Scope: Browser-side generation and publish only; detection happens server-side in lib/forwardProbe.js.

/*
  This measures the opposite direction from the WHEP probes: a user speaking through the
  rover. Browser microphone -> WHIP -> MediaMTX -> the rover's listener -> speaker.

  The timing reference is generated rather than captured. A real microphone would add
  unknown capture latency and depend on there being a real input device, so instead an
  AudioWorklet synthesises bursts on an exact sample grid and that synthetic track is what
  gets published. The number then describes the pipeline rather than the hardware.

  Crucially this direction has no output-device buffering to confuse things. On the WHEP
  side, AudioContext.outputLatency sits inside the measurement and inflates it. Here the
  samples go straight from the worklet into the RTP encoder, so nothing is played locally
  and there is no playback buffer to account for. That makes the uplink number cleaner than
  the downlink one.
*/
function installWhipUplinkProbe() {
  window.__whipProbe = {
    events: [],
    status: 'idle',
    // Wall-clock time corresponding to sample 0 of the generated track. Everything
    // server-side is derived from this.
    startWallMs: null,
    sampleRate: null,
  };

  function note(event, detail) {
    window.__whipProbe.events.push({ at: Date.now(), event, detail: detail ?? null });
  }

  const GENERATOR_SOURCE = `
    class BurstGenerator extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const config = options.processorOptions || {};
        this.intervalSamples = Math.round(sampleRate * (config.intervalMs || 1000) / 1000);
        this.burstSamples = Math.round(sampleRate * (config.durationMs || 40) / 1000);
        this.frequency = config.frequencyHz || 1000;
        this.cursor = 0;
        this.announced = false;
      }
      process(_inputs, outputs) {
        const channel = outputs[0][0];
        if (!this.announced) {
          // currentTime at the first render quantum is the anchor the main thread turns
          // into a wall-clock time for sample 0.
          this.port.postMessage({ type: 'start', audioTime: currentTime });
          this.announced = true;
        }
        for (let i = 0; i < channel.length; i += 1) {
          const position = (this.cursor + i) % this.intervalSamples;
          if (position < this.burstSamples) {
            // Raised cosine, matching the downlink source. A hard-edged burst spreads
            // energy across the spectrum and Opus spends bitrate smearing the transient,
            // which moves the onset being timed.
            const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * (position / this.burstSamples)));
            channel[i] = envelope * 0.8 * Math.sin(2 * Math.PI * this.frequency * ((this.cursor + i) / sampleRate));
          } else {
            channel[i] = 0;
          }
        }
        this.cursor += channel.length;
        return true;
      }
    }
    registerProcessor('burst-generator', BurstGenerator);
  `;

  window.__startWhipUplink = async function startWhipUplink(options) {
    const { whipUrl, intervalMs, durationMs, frequencyHz, iceServers } = options;
    const probe = window.__whipProbe;
    probe.status = 'connecting';

    const audioContext = new AudioContext({ latencyHint: 'interactive' });
    probe.sampleRate = audioContext.sampleRate;

    const workletUrl = URL.createObjectURL(new Blob([GENERATOR_SOURCE], { type: 'application/javascript' }));
    await audioContext.audioWorklet.addModule(workletUrl);

    const generator = new AudioWorkletNode(audioContext, 'burst-generator', {
      processorOptions: { intervalMs, durationMs, frequencyHz },
    });

    const anchored = new Promise((resolve) => {
      generator.port.onmessage = (event) => {
        if (event.data?.type !== 'start') return;
        /*
          Map the worklet's first-quantum audio time to wall clock. No outputLatency term
          here, deliberately: these samples are never played, they are encoded, so a
          playback buffer would not apply.
        */
        const wallForSampleZero = Date.now() - (audioContext.currentTime - event.data.audioTime) * 1000;
        probe.startWallMs = wallForSampleZero;
        note('anchored', Math.round(wallForSampleZero));
        resolve();
      };
    });

    const destination = audioContext.createMediaStreamDestination();
    generator.connect(destination);

    const pc = new RTCPeerConnection({
      iceServers: iceServers || [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    window.__whipPc = pc;

    const [track] = destination.stream.getAudioTracks();
    pc.addTransceiver(track, { direction: 'sendonly' });

    pc.onconnectionstatechange = () => {
      note('connectionState', pc.connectionState);
      probe.status = pc.connectionState;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(whipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!response.ok) {
      probe.status = 'error';
      const body = await response.text().catch(() => '');
      throw new Error(`WHIP ${response.status}: ${body.slice(0, 200)}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    note('answerApplied');

    await audioContext.resume();
    await anchored;
    probe.status = 'publishing';
    return { startWallMs: probe.startWallMs, sampleRate: probe.sampleRate };
  };

  window.__collectWhipStats = async function collectWhipStats() {
    const pc = window.__whipPc;
    if (!pc) return null;
    const report = await pc.getStats();
    let outbound = null;
    let candidatePair = null;
    report.forEach((entry) => {
      if (entry.type === 'outbound-rtp' && entry.kind === 'audio') {
        outbound = {
          packetsSent: entry.packetsSent,
          bytesSent: entry.bytesSent,
          retransmittedPacketsSent: entry.retransmittedPacketsSent,
          targetBitrate: entry.targetBitrate,
        };
      }
      if (entry.type === 'candidate-pair' && entry.nominated) {
        candidatePair = {
          currentRoundTripTime: entry.currentRoundTripTime,
          availableOutgoingBitrate: entry.availableOutgoingBitrate,
        };
      }
    });
    return { outbound, candidatePair };
  };
}

module.exports = { installWhipUplinkProbe };
