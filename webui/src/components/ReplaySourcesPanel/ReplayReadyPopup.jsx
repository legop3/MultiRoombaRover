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

export default function ReplayReadyPopup({ replay, onClose }) {
  const videoUrl = normalizeUrl(replay?.url);
  if (!videoUrl) return null;

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

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-1"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="pointer-events-auto w-full max-w-4xl"
        onClick={(event) => {
          // The backdrop closes the popup, but clicks inside the card must leave video controls usable.
          event.stopPropagation();
        }}
        role="presentation"
      >
        <CardFrame title={title} meta={meta} actions={actions} clipOverflow={false} bodyClassName="space-y-0.5 p-0.5 text-sm text-slate-200">
          <div className="overflow-hidden rounded bg-black">
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              preload="auto"
              playsInline
              className="aspect-video max-h-[72vh] w-full bg-black"
            />
          </div>
        </CardFrame>
      </div>
    </div>
  );
}
