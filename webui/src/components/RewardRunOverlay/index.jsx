// Reward Run Overlay
// Purpose: Defines the Reward Run Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

const SHOW_MS = 3200;

function normalizePayload(payload = {}) {
  const rewardName = typeof payload.rewardName === 'string' && payload.rewardName.trim()
    ? payload.rewardName.trim()
    : 'Unknown Event';
  const goal = Number.isFinite(Number(payload.goal)) ? Math.max(1, Math.floor(Number(payload.goal))) : 0;
  const count = Number.isFinite(Number(payload.count)) ? Math.max(0, Math.floor(Number(payload.count))) : goal;
  return {
    rewardName,
    goal,
    count,
    ts: Date.now(),
  };
}

export default function RewardRunOverlay() {
  const socket = useSocket();
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const masterVolume = Number.isFinite(audioSettings?.masterVolume)
    ? audioSettings.masterVolume
    : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const alertVolume = Number.isFinite(audioSettings?.alertVolume)
    ? audioSettings.alertVolume
    : AUDIO_SETTINGS_DEFAULTS.alertVolume;
  const effectiveAlertVolume = Math.max(0, Math.min(1, masterVolume * alertVolume));
  const [overlay, setOverlay] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio('/tada.mp3');
    audioRef.current.volume = effectiveAlertVolume;
    audioRef.current.load();
  }, [effectiveAlertVolume]);

  useEffect(() => {
    let timer = null;
    function playSound() {
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = effectiveAlertVolume;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    function onRewardRun(payload = {}) {
      const next = normalizePayload(payload);
      setOverlay(next);
      playSound();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setOverlay(null);
      }, SHOW_MS);
    }
    function onLocalRewardRun(event) {
      onRewardRun(event?.detail || {});
    }
    socket.on('buttonBox:rewardRun', onRewardRun);
    window.addEventListener('buttonBox:rewardRunLocalTest', onLocalRewardRun);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('buttonBox:rewardRun', onRewardRun);
      window.removeEventListener('buttonBox:rewardRunLocalTest', onLocalRewardRun);
    };
  }, [effectiveAlertVolume, socket]);

  if (!overlay) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-1 py-1">
      <div className="pointer-events-auto w-full max-w-2xl">
        <div className="surface rounded-none border-2 border-cyan-300 bg-amber-100/95 px-1 py-1 text-center text-black shadow-2xl">
          <div className="flex items-center justify-center gap-1 border-2 border-blue-600 bg-yellow-100 px-0.5 py-1">
            <img src="/party1.gif" alt="" className="hidden shrink-0 sm:block" />
            <div>
            <p className="font-mono text-2xl font-bold text-red-700 sm:text-3xl">
              Running event: {overlay.rewardName}!
            </p>
            <p className="font-mono text-xl font-bold text-blue-800 sm:text-2xl">
              {overlay.count}/{overlay.goal}
            </p>
            </div>
            <img src="/party2.gif" alt="" className="hidden shrink-0 sm:block" />
          </div>
        </div>
      </div>
    </div>
  );
}
