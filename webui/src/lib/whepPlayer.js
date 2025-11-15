function buildAuthHeader(token) {
  if (!token) return {};
  const credential = `${token}:${token}`;
  const encoded =
    typeof btoa === 'function' ? btoa(credential) : Buffer.from(credential).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export class WhepPlayer {
  constructor({ url, token, video, onStatus }) {
    this.url = url;
    this.token = token;
    this.video = video;
    this.pc = null;
    this.abortController = null;
    this.onStatus = onStatus;
  }

  notify(status, detail) {
    if (typeof this.onStatus === 'function') {
      this.onStatus(status, detail);
    }
  }

  async start() {
    if (!this.url || !this.video) {
      throw new Error('Video target missing');
    }
    this.stop();
    this.notify('connecting');
    this.abortController = new AbortController();
    const pc = new RTCPeerConnection();
    this.pc = pc;
    const stream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => stream.addTrack(track));
      this.video.srcObject = stream;
    };
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.notify(state);
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.notify(state);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          ...buildAuthHeader(this.token),
        },
        body: offer.sdp,
        signal: this.abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`WHEP request failed: ${response.status}`);
      }
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      this.notify('playing');
    } catch (err) {
      this.notify('error', err.message);
      this.stop();
      throw err;
    }
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pc) {
      this.pc.getSenders().forEach((sender) => sender.track?.stop());
      this.pc.getReceivers().forEach((receiver) => receiver.track?.stop());
      this.pc.close();
      this.pc = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.notify('stopped');
  }
}
