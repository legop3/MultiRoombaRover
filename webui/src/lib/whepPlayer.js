/* global Buffer */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};


function encodeBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

function buildAuthHeader(token) {
  if (!token) return {};
  const credential = `${token}:${token}`;
  const encoded = encodeBase64(credential);
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

  configureVideoElement() {
    if (!this.video) return;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.disableRemotePlayback = true;
    if ('latencyHint' in HTMLMediaElement.prototype) {
      this.video.latencyHint = 'interactive';
    }
  }

  async start() {
    if (!this.url || !this.video) {
      throw new Error('Video target missing');
    }
    this.stop();
    this.notify('connecting');
    this.configureVideoElement();
    this.abortController = new AbortController();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    const stream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((mediaTrack) => stream.addTrack(mediaTrack));
      this.video.srcObject = stream;
      if (event.track?.kind === 'video' && 'playoutDelayHint' in event.receiver) {
        event.receiver.playoutDelayHint = 0;
      }
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
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
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
      pc.getReceivers().forEach((receiver) => {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = 0;
        }
      });
      await this.video.play().catch(() => {});
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
