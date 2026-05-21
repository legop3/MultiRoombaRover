// Button Box Panel
// Purpose: Defines the Button Box Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { AUDIO_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import ButtonBoxTile from '../ButtonBoxTile/index.jsx';
import CardFrame from '../CardFrame/index.jsx';

const FLASH_MS = 420;
const REWARD_FLASH_MS = 1200;
const BUTTON_TONES = {
  1: 262,
  2: 330,
  3: 392,
  4: 523,
};

export default function ButtonBoxPanel() {
  const buttonBoxButtons = useSessionSelector((state) => state.session?.buttonBox?.buttons ?? []);
  const socket = useSocket();
  const { value: audioSettings } = useSettingsNamespace('audio', AUDIO_SETTINGS_DEFAULTS);
  const masterVolume = Number.isFinite(audioSettings?.masterVolume)
    ? audioSettings.masterVolume
    : AUDIO_SETTINGS_DEFAULTS.masterVolume;
  const alertVolume = Number.isFinite(audioSettings?.alertVolume)
    ? audioSettings.alertVolume
    : AUDIO_SETTINGS_DEFAULTS.alertVolume;
  const effectiveAlertVolume = Math.max(0, Math.min(1, masterVolume * alertVolume));
  const buttons = useMemo(() => {
    const list = Array.isArray(buttonBoxButtons) ? buttonBoxButtons : [];
    if (list.length === 4) return list;
    return [1, 2, 3, 4].map((id) => list.find((entry) => Number(entry?.id) === id) || {
      id,
      count: 0,
      goal: 0,
      rewardName: null,
      rewardId: null,
      rewardNumber: null,
      lastRewardAt: null,
    });
  }, [buttonBoxButtons]);

  const [incFlash, setIncFlash] = useState({});
  const [rewardFlash, setRewardFlash] = useState({});
  const timersRef = useRef(new Map());
  const rewardTimersRef = useRef(new Map());
  const prevRewardAtRef = useRef({});
  const audioCtxRef = useRef(null);

  useEffect(() => {
    const nextMap = {};
    buttons.forEach((button) => {
      nextMap[button.id] = Number(button.lastRewardAt || 0);
    });
    const prev = prevRewardAtRef.current || {};

    buttons.forEach((button) => {
      const id = Number(button.id);
      const nextTs = nextMap[id] || 0;
      const prevTs = Number(prev[id] || 0);
      if (nextTs > 0 && nextTs !== prevTs) {
        setRewardFlash((current) => ({ ...current, [id]: true }));
        const oldTimer = rewardTimersRef.current.get(id);
        if (oldTimer) {
          clearTimeout(oldTimer);
        }
        const timer = setTimeout(() => {
          setRewardFlash((current) => ({ ...current, [id]: false }));
          rewardTimersRef.current.delete(id);
        }, REWARD_FLASH_MS);
        rewardTimersRef.current.set(id, timer);
      }
    });

    prevRewardAtRef.current = nextMap;
  }, [buttons]);

  useEffect(() => {
    function playTone(buttonId) {
      const freq = BUTTON_TONES[buttonId];
      if (!freq) return;
      if (effectiveAlertVolume <= 0) return;
      let ctx = audioCtxRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        audioCtxRef.current = ctx;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const peakGain = 0.14 * effectiveAlertVolume;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.21);
    }

    function onIncrement(payload = {}) {
      const buttonId = Number(payload.buttonId);
      if (!Number.isFinite(buttonId) || buttonId < 1 || buttonId > 4) return;
      setIncFlash((current) => ({ ...current, [buttonId]: true }));
      const oldTimer = timersRef.current.get(buttonId);
      if (oldTimer) {
        clearTimeout(oldTimer);
      }
      const timer = setTimeout(() => {
        setIncFlash((current) => ({ ...current, [buttonId]: false }));
        timersRef.current.delete(buttonId);
      }, FLASH_MS);
      timersRef.current.set(buttonId, timer);
      playTone(buttonId);
    }

    socket.on('buttonBox:increment', onIncrement);
    return () => {
      socket.off('buttonBox:increment', onIncrement);
    };
  }, [effectiveAlertVolume, socket]);

  return (
    <CardFrame title="Button Box" accent="#eab308" bodyClassName="space-y-0.5 text-base">
      <div className="grid grid-cols-4 gap-0.5">
        {buttons.map((button) => {
          const id = Number(button.id);
          const count = Number.isFinite(button.count) ? button.count : 0;
          const goal = Number.isFinite(button.goal) ? button.goal : 0;
          const rewardName = typeof button.rewardName === 'string' && button.rewardName.trim()
            ? button.rewardName.trim()
            : 'Unassigned';
          const rewardNumber = Number.isFinite(button.rewardNumber) ? button.rewardNumber : '?';
          const incActive = Boolean(incFlash[id]);
          const rewardActive = Boolean(rewardFlash[id]);

          return (
            <ButtonBoxTile
              key={id}
              buttonId={id}
              count={count}
              goal={goal}
              rewardNumber={rewardNumber}
              rewardName={rewardName}
              className={[incActive ? 'bg-cyan-900/45' : '', rewardActive ? 'bg-fuchsia-900/45' : ''].filter(Boolean).join(' ')}
            />
          );
        })}
      </div>
    </CardFrame>
  );
}
