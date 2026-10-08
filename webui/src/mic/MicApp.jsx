import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import { RESTART_DELAY_MS } from '../lib/whepPlayback.js';
import { waitForIceGatheringComplete } from '../components/vip/VipAudioUploadCard/whipTransport.js';
import { ControlSystemProvider, KeyboardInputManager, GamepadInputManager, useControlSelector } from '../controls/index.js';
import ControlHint from '../components/ControlHint/index.jsx';

export default function MicApp() {
  return (
    <ControlSystemProvider>
      <KeyboardInputManager />
      <GamepadInputManager />
      <MicPage />
    </ControlSystemProvider>
  );
}

function MicPage() {
  const socket = useSocket();
  const connected = useSessionSelector((state) => state.connected);
  const local = useSessionSelector((state) => state.session?.isLocalNetwork);
  const enabled = useSessionSelector((state) => state.session?.features?.roomAudio);
  const [status, setStatus] = useState('Connecting…');
  const [pttMode, setPttMode] = useState(false);
  const available = Boolean(connected && local && enabled);
  const pttActive = useControlSelector((control) => Boolean(control.state.mic?.pttActive));
  const [pointerHeld, setPointerHeld] = useState(false);
  const [buttonKeyHeld, setButtonKeyHeld] = useState(false);
  const held = available && pttMode && (pttActive || pointerHeld || buttonKeyHeld);
  const transmitting = available && (!pttMode || held);
  const mediaRef = useRef(null);
  const transmittingRef = useRef(transmitting);
  useLayoutEffect(() => {
    transmittingRef.current = transmitting;
    mediaRef.current?.getAudioTracks().forEach((track) => { track.enabled = transmitting; });
  }, [transmitting]);
  useEffect(() => {
    // Pointer capture can outlive focus; release the page button when leaving the page.
    function releaseButton() {
      setPointerHeld(false);
      setButtonKeyHeld(false);
    }
    function visibilityChange() {
      if (document.hidden) releaseButton();
    }
    window.addEventListener('blur', releaseButton);
    document.addEventListener('visibilitychange', visibilityChange);
    return () => {
      window.removeEventListener('blur', releaseButton);
      document.removeEventListener('visibilitychange', visibilityChange);
    };
  }, []);
  useUserIdentitySync();
  useEffect(() => {
    if (!connected || !local || !enabled) return undefined;
    let disposed = false;
    let attempt;
    let media;
    let retryTimer;
    const ack = (event, payload = {}) => new Promise((resolve, reject) => {
      socket.timeout(5000).emit(event, payload, (error, result = {}) => {
        if (error || result.error) reject(error || new Error(result.error));
        else resolve(result);
      });
    });
    const isCurrent = (current) => !disposed && Boolean(current) && attempt === current;
    function closeAttempt() {
      const current = attempt;
      attempt = null;
      if (!current) return;
      clearTimeout(current.timer);
      current.abort.abort();
      if (current.peer) {
        current.peer.onconnectionstatechange = null;
        current.peer.close();
      }
      if (current.resource) fetch(current.resource, { method: 'DELETE', headers: current.headers, keepalive: true }).catch(() => {});
    }
    function retry(current, message) {
      if (!isCurrent(current)) return;
      closeAttempt();
      clearTimeout(retryTimer);
      setStatus(message);
      retryTimer = setTimeout(start, RESTART_DELAY_MS);
    }
    async function start() {
      if (disposed) return;
      // Invalidate the previous attempt before closing it. Late async results
      // and peer events must never change the new attempt's state or timers.
      closeAttempt();
      const current = { abort: new AbortController() };
      attempt = current;
      setStatus('Starting microphone…');
      try {
        await ack('session:setRole', { role: 'spectator' });
        if (!isCurrent(current)) return;
        if (!media || media.getAudioTracks().every((track) => track.readyState === 'ended')) {
          media?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS or localhost');
          const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!isCurrent(current)) { captured.getTracks().forEach((track) => track.stop()); return; }
          media = captured;
          mediaRef.current = media;
          // New capture and reconnect attempts must respect the current PTT state immediately.
          media.getAudioTracks().forEach((track) => { track.enabled = transmittingRef.current; });
          media.getAudioTracks().forEach((track) => { track.onended = () => retry(attempt, 'Microphone disconnected. Retrying…'); });
        }
        const source = await ack('roomAudio:start');
        if (!isCurrent(current)) return;
        current.headers = { Authorization: `Basic ${btoa(`${source.token}:${source.token}`)}` };
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        current.peer = pc;
        media.getAudioTracks().forEach((track) => pc.addTrack(track, media));
        pc.onconnectionstatechange = () => {
          if (!isCurrent(current)) return;
          if (pc.connectionState === 'connected') {
            clearTimeout(current.timer);
            setStatus('Microphone live');
          }
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) retry(current, 'Connection lost. Retrying…');
        };
        await pc.setLocalDescription(await pc.createOffer());
        if (!isCurrent(current)) return;
        await waitForIceGatheringComplete(pc);
        if (!isCurrent(current)) return;
        const response = await fetch(source.url, { method: 'POST', headers: { ...current.headers, 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp, signal: AbortSignal.any([current.abort.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(`Microphone connection failed (${response.status})`);
        const location = response.headers.get('Location');
        current.resource = location ? new URL(location, new URL(source.url, window.location.href)).href : null;
        if (!isCurrent(current)) {
          if (current.resource) fetch(current.resource, { method: 'DELETE', headers: current.headers, keepalive: true }).catch(() => {});
          return;
        }
        const sdp = await response.text();
        if (!isCurrent(current)) return;
        await pc.setRemoteDescription({ type: 'answer', sdp });
        if (!isCurrent(current)) return;
        // A negotiation can hang without reaching a terminal peer state.
        if (pc.connectionState !== 'connected') current.timer = setTimeout(() => retry(current, 'Connection timed out. Retrying…'), 10000);
      } catch (error) { retry(current, `${error.message}. Retrying…`); }
    }
    start();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      closeAttempt();
      media?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      mediaRef.current = null;
      if (socket.connected) socket.emit('roomAudio:stop', {});
    };
  }, [socket, connected, local, enabled]);
  const message = !connected ? 'Connecting…' : local === false ? 'This page is available to local visitors only.' : !enabled ? 'Room audio is disabled.' : status;
  return (
    <main className="min-h-screen bg-neutral-950 p-4 text-slate-200">
      <div className="panel mx-auto max-w-md p-4">
        <h1 className="text-lg font-semibold">Room microphone</h1>
        <p className="mt-2 text-sm" role="status">{message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Microphone mode">
          {[false, true].map((ptt) => (
            <button key={String(ptt)} type="button" aria-pressed={pttMode === ptt}
              className={`button-dark w-full ${pttMode === ptt ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
              onClick={() => {
                setPointerHeld(false);
                setButtonKeyHeld(false);
                setPttMode(ptt);
              }}>
              {ptt ? 'Push to talk' : 'Open mic'}
            </button>
          ))}
        </div>
        {pttMode && (
          <>
            <button type="button" disabled={!available} aria-pressed={held}
              className={`button-dark mt-4 min-h-40 w-full touch-none select-none text-2xl font-semibold ${held ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setPointerHeld(true);
              }}
              onPointerUp={() => setPointerHeld(false)}
              onPointerCancel={() => setPointerHeld(false)}
              onLostPointerCapture={() => setPointerHeld(false)}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key !== ' ' && event.key !== 'Enter') return;
                event.preventDefault();
                setButtonKeyHeld(true);
              }}
              onKeyUp={(event) => {
                if (event.key !== ' ' && event.key !== 'Enter') return;
                event.preventDefault();
                setButtonKeyHeld(false);
              }}
              onBlur={() => setButtonKeyHeld(false)}>
              {held ? 'Talking…' : 'Hold to talk'}
            </button>
            <p className="mt-2 text-center text-sm text-slate-400">Hold the button or <ControlHint actionId="micPtt" /> to talk.</p>
          </>
        )}
      </div>
    </main>
  );
}
