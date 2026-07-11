// WHEP Player Helper
// Purpose: Implements browser playback utilities for WHEP/WebRTC media streams. Scope: Manages stream attach/detach, lifecycle cleanup, and error handling hooks.
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
  constructor({ url, token, video, onStatus, audioOnly = false, receiveAudio = true }) {
    this.url = url;
    this.token = token;
    this.video = video;
    this.audioOnly = audioOnly;
    this.receiveAudio = receiveAudio;
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
    this.video.muted = this.audioOnly ? false : true;
    if (typeof this.video.disableRemotePlayback !== 'undefined') {
      this.video.disableRemotePlayback = true;
    }
    if ('latencyHint' in HTMLMediaElement.prototype) {
      this.video.latencyHint = 'interactive';
    }
  }

  async start() {
    if (!this.url || !this.video) {
      throw new Error('Media target missing');
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
    if (this.audioOnly) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      pc.addTransceiver('video', { direction: 'recvonly' });
      if (this.receiveAudio) {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
    }

    pc.onconnectionstatechange = () => {
      this.notify(pc.connectionState);
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.notify(state);
      }
    };

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: this.audioOnly ? true : this.receiveAudio,
        offerToReceiveVideo: !this.audioOnly,
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
        /*
          MediaMTX includes the useful rejection reason in the response body
          for many 4xx WHEP failures, such as unsupported codecs or malformed
          SDP. Surface that body so camera/video debugging does not stop at a
          generic HTTP status code.
        */
        const body = await response.text().catch(() => '');
        const detail = body ? `: ${body.slice(0, 180)}` : '';
        throw new Error(`WHEP request failed: ${response.status}${detail}`);
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
