registerModule('services/videoPlayer', (require, exports) => {
  const players = new Map();

  class Player {
    constructor(id, options = {}) {
      this.id = id;
      this.options = options;
      this.onStatus = options.onStatus || (() => {});
      this.mount = options.mount || null;
      this.externalVideo = options.videoEl || null;
      this.video = this.externalVideo || this.createVideoElement();
      this.video.muted = true;
      this.status('idle');
    }

    createVideoElement() {
      const el = document.createElement('video');
      el.autoplay = true;
      el.playsInline = true;
      el.controls = false;
      el.muted = true;
      el.style.width = '100%';
      el.style.maxHeight = '360px';
      if (this.mount) {
        this.mount.innerHTML = '';
        this.mount.appendChild(el);
      }
      return el;
    }

    attachAutoPlayLoop() {
      this.autoPlayTimer = window.setInterval(() => {
        if (!this.video) return;
        if (!this.video.paused && !this.video.muted) {
          clearInterval(this.autoPlayTimer);
          this.autoPlayTimer = null;
          return;
        }
        const attempt = () => this.video.play().catch(() => {});
        if (this.video.paused) {
          attempt();
        }
        if (this.video.muted) {
          this.video.muted = false;
          attempt();
        }
      }, 2500);
    }

    status(state, detail) {
      this.onStatus(state, detail);
    }

    async start(url, token) {
      this.stopPeer();
      this.status('connecting');
      this.pc = new RTCPeerConnection();
      this.stream = new MediaStream();
      this.video.srcObject = this.stream;
      this.pc.addTransceiver('video', { direction: 'recvonly' });
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
      this.pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          this.video.srcObject = remoteStream;
        } else {
          this.stream.addTrack(event.track);
        }
        this.video.play().catch(() => {});
      };
      this.attachAutoPlayLoop();

      const credential = token || extractSessionToken(url);
      if (!credential) {
        throw new Error('Missing video session token');
      }
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          Authorization: `Basic ${btoa(`${credential}:${credential}`)}`,
        },
        body: offer.sdp,
      });
      if (!response.ok) {
        throw new Error(`WHEP HTTP ${response.status}`);
      }
      const answer = await response.text();
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
      this.status('playing');
    }

    stopPeer() {
      if (this.autoPlayTimer) {
        clearInterval(this.autoPlayTimer);
        this.autoPlayTimer = null;
      }
      if (this.pc) {
        this.pc.getSenders().forEach((sender) => sender.track && sender.track.stop());
        this.pc.getReceivers().forEach((receiver) => receiver.track && receiver.track.stop());
        this.pc.close();
        this.pc = null;
      }
      if (this.video) {
        const tracks = this.video.srcObject?.getTracks() || [];
        tracks.forEach((t) => t.stop());
        this.video.pause();
        this.video.srcObject = null;
      }
    }

    stop() {
      this.stopPeer();
      if (!this.externalVideo && this.video && this.video.parentElement) {
        this.video.parentElement.removeChild(this.video);
      }
      this.status('stopped');
    }
  }

  function extractSessionToken(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.searchParams.get('session');
    } catch (err) {
      return null;
    }
  }

  async function startStream(id, { url, token, mount, videoEl, onStatus } = {}) {
    stopStream(id);
    const player = new Player(id, { mount, videoEl, onStatus });
    players.set(id, player);
    try {
      await player.start(url, token);
      return player.video;
    } catch (err) {
      player.status('error', err.message);
      player.stop();
      players.delete(id);
      throw err;
    }
  }

  function stopStream(id) {
    const existing = players.get(id);
    if (existing) {
      existing.stop();
      players.delete(id);
    }
  }

  function stopAll() {
    Array.from(players.keys()).forEach(stopStream);
  }

  exports.startStream = startStream;
  exports.stopStream = stopStream;
  exports.stopAll = stopAll;
});
