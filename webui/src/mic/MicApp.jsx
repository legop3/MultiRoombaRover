import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import { RESTART_DELAY_MS } from '../lib/whepPlayback.js';
import { waitForIceGatheringComplete } from '../components/vip/VipAudioUploadCard/whipTransport.js';

export default function MicApp() {
  const socket = useSocket();
  const connected = useSessionSelector((state) => state.connected);
  const local = useSessionSelector((state) => state.session?.isLocalNetwork);
  const enabled = useSessionSelector((state) => state.session?.features?.roomAudio);
  const [status, setStatus] = useState('Connecting…');
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
      if (socket.connected) socket.emit('roomAudio:stop', {});
    };
  }, [socket, connected, local, enabled]);
  const message = !connected ? 'Connecting…' : local === false ? 'This page is available to local visitors only.' : !enabled ? 'Room audio is disabled.' : status;
  return <main className="min-h-screen bg-neutral-950 p-4 text-slate-200"><div className="panel mx-auto max-w-md p-4"><h1 className="text-lg font-semibold">Room microphone</h1><p className="mt-2 text-sm">{message}</p></div></main>;
}
