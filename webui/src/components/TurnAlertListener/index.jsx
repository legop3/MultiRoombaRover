// Turn Alert Listener
// Purpose: Defines the Turn Alert Listener module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useRef } from 'react';
import turnSound from '../../assets/turn_alert.mp3';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

function useAudio(src, volume = 1) {
  const audioRef = useRef(null);
  useEffect(() => {
    audioRef.current = new Audio(src);
    audioRef.current.volume = volume;
    audioRef.current.load();
  }, [src, volume]);
  const play = () => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  };
  return play;
}

export default function TurnAlertListener() {
  const socketId = useSessionSelector((state) => state.session?.socketId || null);
  const assignments = useSessionSelector((state) => state.session?.turnQueues || {});
  const roster = useSessionSelector((state) => state.session?.roster || []);
  const { pushAlert } = useSessionActions();
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const masterVolume = Number.isFinite(audioSettings?.masterVolume) ? audioSettings.masterVolume : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const alertVolume = Number.isFinite(audioSettings?.alertVolume) ? audioSettings.alertVolume : AUDIO_SETTINGS_DEFAULTS.alertVolume;
  const effectiveAlertVolume = Math.max(0, Math.min(1, masterVolume * alertVolume));
  const playSound = useAudio(turnSound, effectiveAlertVolume);
  const seenRoversRef = useRef(new Set());

  useEffect(() => {
    if (!socketId) return;
    const newlyMine = [];
    Object.entries(assignments).forEach(([roverId, info]) => {
      if (!info || !info.current || info.current !== socketId) return;
      if (!seenRoversRef.current.has(roverId)) {
        newlyMine.push(roverId);
        seenRoversRef.current.add(roverId);
      }
    });
    Object.keys(assignments).forEach((roverId) => {
      if (!assignments[roverId] || assignments[roverId].current !== socketId) {
        seenRoversRef.current.delete(roverId);
      }
    });
    if (newlyMine.length === 0) return;
    newlyMine.forEach((roverId) => {
      const roverName = roster.find((r) => String(r.id) === String(roverId))?.name || roverId;
      pushAlert({
        title: 'Your turn!',
        message: `You now control ${roverName}.`,
        color: '#ff5722',
      });
    });
    playSound();
  }, [assignments, playSound, pushAlert, roster, socketId]);

  return null;
}
