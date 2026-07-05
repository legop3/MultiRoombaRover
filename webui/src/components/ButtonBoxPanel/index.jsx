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
import { isFeatureEnabled } from '../../lib/features.js';

const FLASH_MS = 420;
const REWARD_FLASH_MS = 1200;
const LIMIT_FLASH_MS = 800;
const BUTTON_TONES = {
  1: 262,
  2: 330,
  3: 392,
  4: 523,
};

export default function ButtonBoxPanel() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'buttonBox'));

  /*
    The physical button box should vanish by owning its own feature gate. Routes
    can keep mounting this component without leaking empty reward panels.
  */
  if (!enabled) return null;

  return <ButtonBoxPanelContent />;
}

function ButtonBoxPanelContent() {
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
      rewardDescription: null,
      rewardId: null,
      rewardNumber: null,
      dailyCount: 0,
      dailyLimit: null,
      lastRewardAt: null,
    });
  }, [buttonBoxButtons]);

  const [incFlash, setIncFlash] = useState({});
  const [limitFlash, setLimitFlash] = useState({});
  const [rewardFlash, setRewardFlash] = useState({});
  const timersRef = useRef(new Map());
  const limitTimersRef = useRef(new Map());
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
      if (payload.limited) {
        /*
          Capped presses are intentionally visible but not celebratory: red
          feedback tells users the physical press was received, while skipping
          the tone keeps it distinct from real reward progress.
        */
        setLimitFlash((current) => ({ ...current, [buttonId]: true }));
        const oldTimer = limitTimersRef.current.get(buttonId);
        if (oldTimer) {
          clearTimeout(oldTimer);
        }
        const timer = setTimeout(() => {
          setLimitFlash((current) => ({ ...current, [buttonId]: false }));
          limitTimersRef.current.delete(buttonId);
        }, LIMIT_FLASH_MS);
        limitTimersRef.current.set(buttonId, timer);
        return;
      }
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

  useEffect(
    () => () => {
      /*
        The panel owns short visual timers for press feedback. Clearing them on
        unmount avoids leaving stale timeout callbacks behind if the panel is
        hidden during a burst of button-box activity.
      */
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
      limitTimersRef.current.forEach((timer) => clearTimeout(timer));
      limitTimersRef.current.clear();
      rewardTimersRef.current.forEach((timer) => clearTimeout(timer));
      rewardTimersRef.current.clear();
    },
    [],
  );

  return (
    <CardFrame title="Button Box" bodyClassName="space-y-0.5 text-base">
      <div className="grid grid-cols-4 gap-0.5">
        {buttons.map((button) => {
          const id = Number(button.id);
          const count = Number.isFinite(button.count) ? button.count : 0;
          const goal = Number.isFinite(button.goal) ? button.goal : 0;
          const dailyCount = Number.isFinite(button.dailyCount) ? button.dailyCount : 0;
          const dailyLimit = Number.isFinite(button.dailyLimit) ? button.dailyLimit : null;
          const rewardName = typeof button.rewardName === 'string' && button.rewardName.trim()
            ? button.rewardName.trim()
            : 'Unassigned';
          const rewardDescription = typeof button.rewardDescription === 'string' && button.rewardDescription.trim()
            ? button.rewardDescription.trim()
            : null;
          const rewardNumber = Number.isFinite(button.rewardNumber) ? button.rewardNumber : '?';
          const incActive = Boolean(incFlash[id]);
          const limitActive = Boolean(limitFlash[id]);
          const rewardActive = Boolean(rewardFlash[id]);

          return (
            <ButtonBoxTile
              key={id}
              buttonId={id}
              count={count}
              goal={goal}
              dailyCount={dailyCount}
              dailyLimit={dailyLimit}
              rewardNumber={rewardNumber}
              rewardName={rewardName}
              rewardDescription={rewardDescription}
              limited={limitActive}
              className={[
                incActive ? 'bg-cyan-900/45' : '',
                limitActive ? 'bg-red-950/70 ring-1 ring-red-500/70' : '',
                rewardActive ? 'bg-fuchsia-900/45' : '',
              ].filter(Boolean).join(' ')}
            />
          );
        })}
      </div>
    </CardFrame>
  );
}
