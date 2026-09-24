import PtzLightingPod from './PtzLightingPod.jsx';
import PtzLiveVideo, { PTZ_CAMERA_ID } from '../../components/PtzLiveVideo/index.jsx';
import ChatExpansion from '../../components/HudOverlays/newgen/CornerPods/ChatExpansion.jsx';
import TopLeftPod from '../../components/HudOverlays/newgen/CornerPods/TopLeftPod.jsx';
import { usePtzCameraSnapshots } from '../../hooks/usePtzCameraSnapshot.js';
function PtzSnapshotPreview({ feed, label = 'PTZ Camera', className = 'h-full w-full', statusClassName = 'pointer-events-none absolute left-1 bottom-1 z-20 font-medium text-slate-100 text-[0.65rem]' }) {
  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      {feed?.objectUrl ? (
        <img src={feed.objectUrl} alt={label} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">Waiting for snapshot...</div>
      )}
      {/*
        Snapshot mode should look like the regular rover video player: the
        camera name belongs to the surrounding card/menu, while the media pane
        only exposes stream health in the small bottom-left diagnostic overlay.
      */}
      <div className={statusClassName}>
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {feed?.error ? `Error: ${feed.error}` : feed?.status || 'connecting'}</span>
        </div>
      </div>
    </div>
  );
}

function PtzMediaPane({ ptz, open, framed = true, compact = false }) {
  const shouldUseLiveVideo = ptz?.viewMode === 'live';
  const snapshotFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: open && !shouldUseLiveVideo });
  const snapshot = snapshotFeeds[PTZ_CAMERA_ID] || null;
  const statusClassName = `pointer-events-none absolute left-1 ${compact ? 'bottom-1' : 'bottom-24'} z-20 text-[0.65rem] font-medium text-slate-100`;
  const media = (
    <>
      {shouldUseLiveVideo ? (
        <PtzLiveVideo enabled={open} startMuted={false} statusClassName={statusClassName} />
      ) : (
        <PtzSnapshotPreview feed={snapshot} label={ptz?.name || 'PTZ Camera'} statusClassName={statusClassName} />
      )}
      {ptz?.turn ? <TopLeftPod compact={compact} turns={ptz.turn} /> : null}
      {/* Mobile already has lighting controls beside/below the video. */}
      {!compact ? <PtzLightingPod /> : null}
      <ChatExpansion podOpen={false} />
    </>
  );

  if (!framed) {
    return <div className="relative h-full min-h-0 w-full overflow-hidden bg-black">{media}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
      <div className="relative aspect-video max-h-full w-full max-w-full overflow-hidden bg-black">
        {media}
      </div>
    </div>
  );
}

export { PtzSnapshotPreview, PtzMediaPane };
