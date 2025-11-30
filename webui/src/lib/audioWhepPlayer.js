/* global Buffer */

import { buildAuthHeader } from './whepAuth.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export class AudioWhepPlayer {
  constructor({ url, token, audio, onStatus }) {
    this.url = url;
    this.token = token;
    this.audio = audio;
    this.pc = null;
    this.abortController = null;
    this.onStatus = onStatus;
  }

  notify(status, detail) {
    if (typeof this.onStatus === 'function') {
      this.onStatus(status, detail);
    }
  }

  configureElement() {
    if (!this.audio) return;
    this.audio.autoplay = true;
    this.audio.muted = false;
    this.audio.playsInline = true;
  }

  async start() {
    if (!this.url || !this.audio) {
      throw new Error('Audio target missing');
    }
    this.stop();
    this.configureElement();
    this.notify('connecting');
    this.abortController = new AbortController();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    const stream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => stream.addTrack(track));
      this.audio.srcObject = stream;
      if (event.receiver && 'playoutDelayHint' in event.receiver) {
        event.receiver.playoutDelayHint = 0;
      }
    };
    pc.addTransceiver('audio', { direction: 'recvonly' });

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
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
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
        throw new Error(`WHEP audio request failed: ${response.status}`);
      }
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      pc.getReceivers().forEach((receiver) => {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = 0;
        }
      });
      await this.audio.play().catch(() => {});
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
      this.pc.getSenders().forEach((s) => s.track?.stop());
      this.pc.getReceivers().forEach((r) => r.track?.stop());
      this.pc.close();
      this.pc = null;
    }
    if (this.audio) {
      this.audio.srcObject = null;
    }
    this.notify('stopped');
  }
}
