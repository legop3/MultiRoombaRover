import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';
import { RESTART_DELAY_MS } from '../lib/whepPlayback.js';
import { ControlSystemProvider, KeyboardInputManager, GamepadInputManager, useControlSelector } from '../controls/index.js';
import ControlHint from '../components/ControlHint/index.jsx';
import MediaMTXWebRTCPublisher from '../../.cache/mediamtx/publisher.js';
import useServerUrl from '../hooks/useServerUrl.js';

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
  const serverUrl = useServerUrl();
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
      const publisher = current.publisher;
      publisher?.close();
      // Upstream close stops the peer and retry timer but leaves HTTP session cleanup to us.
      if (publisher?.sessionUrl) fetch(publisher.sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
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
      const current = {};
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
        setStatus('Connecting audio…');
        current.publisher = new MediaMTXWebRTCPublisher({
          url: serverUrl(source.url),
          user: source.token,
          pass: source.token,
          stream: media,
          audioCodec: 'opus',
          audioBitrate: 64,
          audioVoice: true,
          onConnected: () => {
            if (isCurrent(current)) setStatus('Microphone live');
          },
          // The publisher owns transport retries; restarting it here would create competing loops.
          onError: (message) => {
            if (isCurrent(current)) setStatus(message);
          },
        });
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
  }, [socket, connected, local, enabled, serverUrl]);
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
