// Replay Ready Popup
// Purpose: Presents the latest Discord-hosted replay video to web users as soon as upload completes.
// Scope: Owns the ephemeral modal shell, immediate video loading, and click-outside close behavior.
import { useCallback, useEffect, useRef } from 'react';
import CardFrame from '../CardFrame/index.jsx';

const CLOSE_AFTER_VIDEO_END_MS = 5000;
const CLOSE_IF_VIDEO_NEVER_PLAYS_MS = 10000;

function normalizeUrl(value) {
  const text = String(value || '').trim();
  return text || null;
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReplayReadyPopup({ replay, onClose, variant = 'modal' }) {
  const fallbackCloseTimerRef = useRef(null);
  const endedCloseTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const videoUrl = normalizeUrl(replay?.url);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const clearCloseTimers = useCallback(() => {
    if (fallbackCloseTimerRef.current) {
      clearTimeout(fallbackCloseTimerRef.current);
      fallbackCloseTimerRef.current = null;
    }
    if (endedCloseTimerRef.current) {
      clearTimeout(endedCloseTimerRef.current);
      endedCloseTimerRef.current = null;
    }
  }, []);

  const closePopup = useCallback(() => {
    // Timers are always cleared before closing so a stale timeout from a previous
    // replay cannot close the next replay popup after React reuses this component.
    clearCloseTimers();
    onCloseRef.current?.();
  }, [clearCloseTimers]);

  useEffect(() => {
    clearCloseTimers();
    if (!videoUrl) return undefined;

    // A Discord media URL can fail because the attachment URL expired, the browser
    // cannot load the remote media, or autoplay never reaches actual playback. This
    // fallback keeps both popup variants from getting stuck forever in those cases.
    fallbackCloseTimerRef.current = setTimeout(closePopup, CLOSE_IF_VIDEO_NEVER_PLAYS_MS);
    return clearCloseTimers;
  }, [clearCloseTimers, closePopup, videoUrl]);

  const handleVideoPlaying = useCallback(() => {
    if (!fallbackCloseTimerRef.current) return;
    // Once playback really starts, the video has proven useful. From this point on,
    // the popup should stay open until the viewer finishes the replay or closes it.
    clearTimeout(fallbackCloseTimerRef.current);
    fallbackCloseTimerRef.current = null;
  }, []);

  const handleVideoEnded = useCallback(() => {
    if (endedCloseTimerRef.current) {
      clearTimeout(endedCloseTimerRef.current);
    }
    // Leaving the finished replay visible briefly gives people time to notice the
    // final frame and use the Discord/open-video links before the popup cleans itself up.
    endedCloseTimerRef.current = setTimeout(closePopup, CLOSE_AFTER_VIDEO_END_MS);
  }, [closePopup]);

  const videoLifecycleProps = {
    onPlaying: handleVideoPlaying,
    onEnded: handleVideoEnded,
  };

  if (!videoUrl) return null;

  const isPanel = variant === 'panel';
  const isFloatingPanel = variant === 'floating-panel';
  const isModal = !isPanel && !isFloatingPanel;
  const title = String(replay?.title || 'Replay').trim() || 'Replay';
  const messageUrl = normalizeUrl(replay?.messageUrl);
  const meta = formatBytes(replay?.size) || null;
  const actions = (
    <div className="flex items-center gap-0.5">
      <a href={videoUrl} target="_blank" rel="noreferrer" className="button-dark px-1 py-0.25 text-[0.72rem]">
        Open video
      </a>
      {messageUrl ? (
        <a href={messageUrl} target="_blank" rel="noreferrer" className="button-dark px-1 py-0.25 text-[0.72rem]">
          Discord
        </a>
      ) : null}
      <button type="button" onClick={onClose} className="button-dark px-1 py-0.25 text-[0.72rem]">
        Close
      </button>
    </div>
  );

  if (isFloatingPanel) {
    return (
      <CardFrame
        title={title}
        meta={meta}
        actions={actions}
        clipOverflow={false}
        bodyClassName="p-0.5"
      >
        <div className="overflow-hidden rounded bg-black">
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            autoPlay
            preload="auto"
            playsInline
            muted
            {...videoLifecycleProps}
            // The floating panel is intentionally compact because it appears for users who
            // did not ask for the replay. It still loads the video immediately, but its
            // bounded height prevents the floating card from covering too much of the UI.
            className="aspect-video max-h-[14rem] w-full bg-black"
          />
        </div>
      </CardFrame>
    );
  }

  const card = (
    <CardFrame
      title={title}
      meta={meta}
      actions={actions}
      fillHeight={isPanel || isModal}
      clipOverflow={false}
      className={isModal ? 'h-full w-full' : ''}
      bodyClassName={`${isPanel || isModal ? 'flex min-h-0 flex-1 flex-col' : ''} space-y-0.5 p-0.5 text-sm text-slate-200`}
    >
      <div className={`${isPanel || isModal ? 'min-h-0 flex-1' : ''} overflow-hidden rounded bg-black`}>
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay
          preload="auto"
          playsInline
          {...videoLifecycleProps}
          // Spectator pages use the modal variant as the primary replay viewer, so
          // that video should fill the available viewport instead of behaving like
          // a centered dialog preview. object-contain preserves the replay frame
          // without cropping if the browser viewport is not the same aspect ratio.
          className={`${isPanel ? 'h-full min-h-[10rem]' : isModal ? 'h-full object-contain' : 'aspect-video max-h-[72vh]'} w-full bg-black`}
        />
      </div>
    </CardFrame>
  );

  if (isPanel) {
    return <div className="flex h-full min-h-[14rem] flex-col">{card}</div>;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-stretch justify-stretch bg-black" onClick={onClose} role="presentation">
      <div
        className="pointer-events-auto h-full w-full"
        onClick={(event) => {
          // The backdrop closes the popup, but clicks inside the fullscreen card
          // must leave video controls and header actions usable.
          event.stopPropagation();
        }}
        role="presentation"
      >
        {card}
      </div>
    </div>
  );
}
