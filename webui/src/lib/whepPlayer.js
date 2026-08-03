// WHEP Player Helper
// Purpose: Implements browser playback utilities for WHEP/WebRTC media streams. Scope: Manages stream attach/detach, lifecycle cleanup, and error handling hooks.
/* global Buffer */

/*
  ICE servers are configurable at runtime rather than compiled in.

  The previous list contained `turn:your.turn.server:3478` with username 'user' and
  credential 'pass'. That host does not resolve and those credentials are placeholders,
  so every peer connection was asking the browser to allocate against a server that
  could never answer. Latency measurement on loopback showed no measurable cost (173ms
  against 172ms) because host candidates win immediately there, so this is a
  correctness fix rather than the latency fix it first looked like - but on a real
  network, gathering against an unreachable TURN server is time spent for nothing.

  Removing it outright would also remove the ability to ever configure a real one, so
  the list is now supplied by the caller and falls back to STUN only.
*/
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

function buildRtcConfig(iceServers) {
  return {
    iceServers: Array.isArray(iceServers) && iceServers.length ? iceServers : DEFAULT_ICE_SERVERS,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

function encodeBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

/*
  Ask the receiver for the smallest buffer it will accept.

  jitterBufferTarget, the standardised successor to playoutDelayHint, was measured here
  and deliberately NOT adopted. Setting it to 0 changed nothing: 13ms glass-to-glass
  either way, with the receiver's own reported buffer at 8.0ms against 7.8ms - inside
  run-to-run noise. Chromium is already at its floor.

  It is left out because it would have been unmeasured risk for no measured gain. A
  smaller target buffer has less slack to absorb network jitter, and loopback cannot
  test that, so the failure mode would have been freezes and audio concealment appearing
  only in production. See webrtc/RISK.md.

  Wrapped anyway because a rejected latency hint must never stop playback.
*/
function applyLowLatencyHints(receiver) {
  if (!receiver) return;
  try {
    if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0;
  } catch {
    // Ignored: a hint is an optimisation, not a requirement.
  }
}

function buildAuthHeader(token) {
  if (!token) return {};
  const credential = `${token}:${token}`;
  const encoded = encodeBase64(credential);
  return { Authorization: `Basic ${encoded}` };
}

export class WhepPlayer {
  constructor({
    url,
    token,
    video,
    onStatus,
    audioOnly = false,
    receiveAudio = true,
    startMuted = null,
    iceServers = null,
  }) {
    this.url = url;
    this.token = token;
    this.video = video;
    this.audioOnly = audioOnly;
    this.receiveAudio = receiveAudio;
    /*
      Browser autoplay usually requires normal video streams to start muted,
      while audio-only streams need to start audible. Keep that historical
      default, but allow a caller that is already behind a user gesture, such as
      the PTZ fullscreen controller, to request audible inline audio.
    */
    this.startMuted = startMuted === null ? !audioOnly : Boolean(startMuted);
    this.pc = null;
    this.abortController = null;
    this.onStatus = onStatus;
    this.iceServers = iceServers;
    // WHEP resource URL from the POST's Location header. Needed to tell the server the
    // session is over; see releaseSession().
    this.resourceUrl = null;
    this.releaseOnPageHide = null;
  }

  /*
    Ends the session server-side.

    Closing the RTCPeerConnection is purely local: the server finds out only when ICE times
    out. Measured against a real MediaMTX, that took 31.5 seconds, during which it kept
    sending the full stream to a viewer that had gone - about 5.7MB of upload per abandoned
    session at the bitrate these streams run at. Sending the DELETE the WHEP spec defines
    ended the session in 12ms instead.

    That matters here specifically because the production server is upload-constrained and
    every viewer costs a full copy of the stream. Switching between rovers, or reloading the
    page, used to leave a ghost session consuming upload for half a minute each time.

    keepalive is what makes this work during page teardown: a normal fetch is cancelled when
    the document goes away, which is exactly the case that leaks. It also deliberately does
    NOT use this.abortController, because stop() aborts that controller and would cancel this
    request before it left.
  */
  releaseSession() {
    const resourceUrl = this.resourceUrl;
    this.resourceUrl = null;
    if (!resourceUrl) return;
    try {
      fetch(resourceUrl, {
        method: 'DELETE',
        headers: buildAuthHeader(this.token),
        keepalive: true,
      }).catch(() => {
        // Ignored: teardown is best-effort. Failing to release leaves the server to time the
        // session out as it did before, which is the old behaviour rather than a new fault.
      });
    } catch {
      // Ignored for the same reason.
    }
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
    this.video.muted = this.startMuted;
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
    const pc = new RTCPeerConnection(buildRtcConfig(this.iceServers));
    this.pc = pc;
    const stream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((mediaTrack) => stream.addTrack(mediaTrack));
      this.video.srcObject = stream;
      applyLowLatencyHints(event.receiver);
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
      /*
        Recorded before the answer is applied, so a failure in setRemoteDescription still
        leaves a resource URL for stop() to release. The header is allowed to be relative by
        the WHEP spec, so it is resolved against the request URL rather than used as-is.
      */
      const location = response.headers.get('location');
      if (location) {
        try {
          this.resourceUrl = new URL(location, this.url).href;
        } catch {
          this.resourceUrl = null;
        }
      }
      /*
        A tab closing or navigating away never calls stop(), and that is the common case for
        an abandoned session. pagehide covers it, including Safari's back/forward cache where
        unload does not fire.
      */
      if (typeof window !== 'undefined' && !this.releaseOnPageHide) {
        this.releaseOnPageHide = () => this.releaseSession();
        window.addEventListener('pagehide', this.releaseOnPageHide);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      pc.getReceivers().forEach(applyLowLatencyHints);
      await this.video.play().catch(() => {});
      this.notify('playing');
    } catch (err) {
      this.notify('error', err.message);
      this.stop();
      throw err;
    }
  }

  stop() {
    // Before aborting: the abort would cancel an in-flight DELETE, and releasing the session
    // is the whole point of this ordering.
    this.releaseSession();
    if (this.releaseOnPageHide && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.releaseOnPageHide);
      this.releaseOnPageHide = null;
    }
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
