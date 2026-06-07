// Replay Ready Popup
// Purpose: Presents the latest Discord-hosted replay video to web users as soon as upload completes.
// Scope: Owns the ephemeral modal shell, immediate video loading, and click-outside close behavior.
import CardFrame from '../CardFrame/index.jsx';

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
  const videoUrl = normalizeUrl(replay?.url);
  if (!videoUrl) return null;

  const isPanel = variant === 'panel';
  const isFloatingPanel = variant === 'floating-panel';
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
            // The floating panel is intentionally compact because it appears for users who
            // did not ask for the replay. It still loads the video immediately, but its
            // bounded height prevents the floating card from covering too much of the UI.
            className="aspect-video max-h-[12rem] w-full bg-black"
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
      fillHeight={isPanel}
      clipOverflow={false}
      bodyClassName={`${isPanel ? 'flex min-h-0 flex-1 flex-col' : ''} space-y-0.5 p-0.5 text-sm text-slate-200`}
    >
      <div className={`${isPanel ? 'min-h-0 flex-1' : ''} overflow-hidden rounded bg-black`}>
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay
          preload="auto"
          playsInline
          className={`${isPanel ? 'h-full min-h-[10rem]' : 'aspect-video max-h-[72vh]'} w-full bg-black`}
        />
      </div>
    </CardFrame>
  );

  if (isPanel) {
    return <div className="flex h-full min-h-[14rem] flex-col">{card}</div>;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-1" onClick={onClose} role="presentation">
      <div
        className="pointer-events-auto w-full max-w-4xl"
        onClick={(event) => {
          // The backdrop closes the popup, but clicks inside the card must leave video controls usable.
          event.stopPropagation();
        }}
        role="presentation"
      >
        {card}
      </div>
    </div>
  );
}
