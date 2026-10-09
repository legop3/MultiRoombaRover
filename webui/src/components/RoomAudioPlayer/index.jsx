import { useCallback, useEffect, useRef } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import { RESTART_DELAY_MS, startWhepPlayback } from '../../lib/whepPlayback.js';
import useWhepRestart from '../../hooks/useWhepRestart.js';
import useServerUrl from '../../hooks/useServerUrl.js';

function StreamPlayer({ id, volume }) {
  const socket = useSocket();
  const serverUrl = useServerUrl();
  const audio = useRef(null);
  const { restartToken, scheduleRestart } = useWhepRestart();
  useEffect(() => {
    let active = true;
    let stop;
    let token;
    socket.timeout(5000).emit('video:request', { type: 'roomAudio', id }, (error, response = {}) => {
      if (!active) {
        if (response.token && socket.connected) socket.emit('roomAudio:release', { token: response.token });
        return;
      }
      token = response.token;
      if (error || response.error || !response.url) { scheduleRestart(); return; }
      stop = startWhepPlayback({
        ...response, url: serverUrl(response.url), video: audio.current, audioOnly: true,
        onStatus: () => {}, onError: () => {}, scheduleRestart,
      });
    });
    return () => {
      active = false; stop?.();
      if (token && socket.connected) socket.emit('roomAudio:release', { token });
    };
  }, [id, socket, restartToken, scheduleRestart, serverUrl]);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume)); }, [volume]);
  return <audio ref={audio} autoPlay />;
}

export default function RoomAudioPlayer() {
  const container = useRef(null);
  const streams = useSessionSelector((state) => state.session?.roomAudioStreams);
  const connected = useSessionSelector((state) => state.connected);
  const { value } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const volume = (value?.masterVolume ?? 1) * (value?.roomVolume ?? 1);
  const play = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const elements = [...root.querySelectorAll('audio')].filter((audio) => audio.srcObject);
    if (!elements.length) return;
    // Call play during the gesture; blocked playback retries on the interval.
    elements.forEach((audio) => { audio.play().catch(() => {}); });
  }, []);
  useEffect(() => {
    if (!connected) return undefined;
    const timer = setInterval(play, RESTART_DELAY_MS);
    window.addEventListener('pointerdown', play);
    window.addEventListener('keydown', play);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', play);
      window.removeEventListener('keydown', play);
    };
  }, [connected, play]);
  if (!connected) return null;
  return (
    <div ref={container} className="contents">
      {(streams || []).map((stream) => <StreamPlayer key={stream.id} id={stream.id} volume={volume} />)}
    </div>
  );
}
