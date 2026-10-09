// whip Transport
// Purpose: Defines the whip Transport module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
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
