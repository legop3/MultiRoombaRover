// WHIP/WebRTC transport helpers for microphone forwarding.
export function waitForIceGatheringComplete(pc, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }, timeoutMs);
    function onChange() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function isPeerTransportReady(pc) {
  if (!pc) return false;
  const conn = pc.connectionState;
  const ice = pc.iceConnectionState;
  if (conn === 'connected') return true;
  if (ice === 'connected' || ice === 'completed') return true;
  return false;
}

export function waitForPeerConnected(pc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!pc) {
      reject(new Error('Peer connection missing'));
      return;
    }
    if (isPeerTransportReady(pc)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Peer connection timeout'));
    }, timeoutMs);
    const onState = () => {
      if (isPeerTransportReady(pc)) {
        cleanup();
        resolve();
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.iceConnectionState === 'failed'
      ) {
        cleanup();
        reject(new Error(`Peer connection ${pc.connectionState || pc.iceConnectionState}`));
      }
    };
    function cleanup() {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', onState);
      pc.removeEventListener('iceconnectionstatechange', onState);
    }
    pc.addEventListener('connectionstatechange', onState);
    pc.addEventListener('iceconnectionstatechange', onState);
  });
}

export async function configureSenderForLowLatency(sender) {
  if (!sender?.getParameters || !sender?.setParameters) return;
  const params = sender.getParameters() || {};
  const first = (params.encodings && params.encodings[0]) || {};
  params.encodings = [
    {
      ...first,
      maxBitrate: 64000,
      dtx: 'disabled',
    },
  ];
  try {
    await sender.setParameters(params);
  } catch {
    // Browser support varies; keep defaults if rejected.
  }
}

export function waitForOutboundAudioFlow(pc, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!pc) {
      reject(new Error('Peer connection missing'));
      return;
    }
    const start = Date.now();
    let baseline = -1;
    const timer = setInterval(async () => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('WHIP connected but no outbound audio flow'));
        return;
      }
      try {
        const senders = pc.getSenders().filter((s) => s.track?.kind === 'audio');
        for (const sender of senders) {
          const stats = await sender.getStats();
          for (const report of stats.values()) {
            if (report.type !== 'outbound-rtp' || report.kind !== 'audio') continue;
            const sent = Number(report.bytesSent || 0);
            const packets = Number(report.packetsSent || 0);
            if (baseline < 0) {
              baseline = sent;
            } else if (sent > baseline + 200 || packets > 5) {
              clearInterval(timer);
              resolve();
              return;
            }
          }
        }
      } catch {
        // Keep polling until timeout.
      }
    }, 250);
  });
}
