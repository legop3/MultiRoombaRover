import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { useRoomCameraSnapshots } from '../hooks/useRoomCameraSnapshots.js';
import RoomCameraFeed from './RoomCameraFeed.jsx';

function EmptyState() {
  return (
    <div className="panel-section space-y-0.5 text-sm">
      <p className="text-center text-slate-400">No room cameras configured.</p>
      <p className="text-center text-slate-500">Add entries to server config to populate this list.</p>
    </div>
  );
}

const ORIENTATIONS = ['horizontal', 'vertical'];

function normalizeOrientation(value, fallback) {
  if (ORIENTATIONS.includes(value)) {
    return value;
  }
  return fallback;
}

export default function RoomCameraPanel({
  defaultOrientation = 'horizontal',
  orientation: forcedOrientation,
  hideLayoutToggle = false,
  hideHeader = false,
  panelId = null,
}) {
  const { session, triggerReplay } = useSession();
  const cameras = session?.roomCameras || [];
  const feedMap = useRoomCameraSnapshots(cameras.map((camera) => ({ id: camera.id })));
  const { value: orientationSettings, save: saveOrientationSettings } = useSettingsNamespace('roomCameraPanels', {});
  const [orientation, setOrientation] = useState(() =>
    normalizeOrientation(
      panelId ? orientationSettings?.[panelId] : defaultOrientation,
      'horizontal',
    ),
  );

  useEffect(() => {
    if (!panelId) return;
    const stored = orientationSettings?.[panelId];
    if (!stored) return;
    setOrientation(normalizeOrientation(stored, 'horizontal'));
    // only respond to changes for this panel id
  }, [panelId, orientationSettings?.[panelId]]);
  const effectiveOrientation = forcedOrientation
    ? normalizeOrientation(forcedOrientation, 'horizontal')
    : orientation;
  const containerClass =
    effectiveOrientation === 'vertical' ? 'flex flex-col gap-0.5' : 'grid gap-0.5 md:grid-cols-2';
  const showLayoutToggle = !hideLayoutToggle && !forcedOrientation && cameras.length > 0;
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const replayState = session?.replay || null;
  const replayRemainingMs = useMemo(() => {
    if (!replayState?.lastTriggeredAt || !replayState?.cooldownMs) return 0;
    const remaining = replayState.lastTriggeredAt + replayState.cooldownMs - Date.now();
    return Math.max(0, remaining);
  }, [replayState?.lastTriggeredAt, replayState?.cooldownMs, replayState?.remainingMs]);
  const [remainingMs, setRemainingMs] = useState(replayRemainingMs);
  const replayDisabled =
    replayBusy || session?.mode === 'lockdown' || !cameras.length || remainingMs > 0;

  useEffect(() => {
    setRemainingMs(replayRemainingMs);
    if (!replayState?.lastTriggeredAt || !replayState?.cooldownMs) {
      return undefined;
    }
    const interval = setInterval(() => {
      const next = replayState.lastTriggeredAt + replayState.cooldownMs - Date.now();
      setRemainingMs(Math.max(0, next));
    }, 250);
    return () => clearInterval(interval);
  }, [replayState?.lastTriggeredAt, replayState?.cooldownMs, replayRemainingMs]);

  const handleReplay = async () => {
    if (replayDisabled) return;
    setReplayError(null);
    setReplayBusy(true);
    try {
      await triggerReplay();
    } catch (err) {
      setReplayError(err.message);
    } finally {
      setReplayBusy(false);
    }
  };
  const applyOrientation = (next) => {
    setOrientation(next);
    if (panelId) {
      saveOrientationSettings((current) => ({ ...(current || {}), [panelId]: next }));
    }
  };

  if (cameras.length === 0) {
    return <EmptyState />;
  }

  return (
    <section className="panel-section space-y-0.5 text-base">
      {!hideHeader && (
        <header className="flex flex-wrap items-center justify-between gap-0.5 text-sm text-slate-400">
          <div className="flex items-center gap-1">
            <p>Room cameras</p>
            <span className="text-xs text-slate-500">{cameras.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 ${
                replayDisabled
                  ? 'border-slate-700 text-slate-500'
                  : 'border-slate-500 text-slate-200 hover:border-slate-300 hover:text-white'
              }`}
              onClick={handleReplay}
              disabled={replayDisabled}
              title={session?.mode === 'lockdown' ? 'Replay disabled in lockdown' : 'Send replay to Discord'}
            >
              {remainingMs > 0 ? `Replay (${Math.ceil(remainingMs / 1000)}s)` : replayBusy ? 'Replay…' : 'Replay'}
            </button>
            {replayError && <span className="text-amber-400">{replayError}</span>}
            {showLayoutToggle && (
              <div className="flex items-center gap-0.5">
                <span className="text-slate-500">Layout:</span>
                <div className="inline-flex overflow-hidden rounded border border-slate-700">
                  {ORIENTATIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`px-1 py-0.5 ${effectiveOrientation === option ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                      onClick={() => applyOrientation(option)}
                    >
                      {option === 'vertical' ? 'Vertical' : 'Grid'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>
      )}
      <div className={containerClass}>
        {cameras.map((camera) => {
          const feed = feedMap[camera.id] || null;
          return (
            <article key={camera.id} className="w-full space-y-0.5 rounded bg-zinc-950 p-0.5 shadow-inner shadow-black/40">
              {/* <header className="space-y-0.5">
                <p className="text-lg font-semibold text-white">{camera.name || camera.id}</p>
                {camera.description && <p className="text-xs text-slate-500">{camera.description}</p>}
              </header> */}
              <RoomCameraFeed feed={feed} label={camera.name || camera.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
