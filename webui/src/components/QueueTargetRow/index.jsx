// Queue Target Row
// Purpose: Renders the shared queue-row visual language used by rover queues and PTZ.
// Scope: Owns row chrome, queue chips, timer labels, and row/button event plumbing;
// callers still own target-specific permission checks and request actions.
import RoverLabel from '../RoverLabel/index.jsx';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function roleColors(role) {
  switch (role) {
    case 'admin':
    case 'lockdown':
      return 'text-amber-300';
    case 'spectator':
      return 'text-slate-400';
    default:
      return 'text-sky-300';
  }
}

function formatQueueUserLabel(user, selfId) {
  /*
    Queue chips need to be readable even when a socket has no nickname yet.
    Keeping the socket-prefix fallback here means rover queues and PTZ queues
    degrade identically instead of each target inventing its own anonymous label.
  */
  if (!user) return '';
  const base = user.nickname || user.label || user.socketId?.slice(0, 6) || 'unknown';
  if (user.socketId && user.socketId === selfId) {
    return `${base} (you)`;
  }
  return base;
}

export function QueueUserChips({
  targetId,
  queue = [],
  currentId = null,
  nextId = null,
  selfId = null,
  lookupUser,
}) {
  if (!queue.length) {
    return <p className="text-[0.7rem] text-slate-500">No queue.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {queue.map((socketId, idx) => {
        const user = lookupUser?.(socketId) || { socketId, nickname: null, role: null };
        const isCurrent = socketId === currentId;
        const isNext = Boolean(nextId && socketId === nextId && !isCurrent);
        /*
          These classes intentionally mirror the original rover queue styling.
          PTZ feeds the same current/next model into this component, so the user
          does not have to learn a different visual vocabulary for camera turns.
        */
        const highlightClass = isCurrent
          ? 'bg-sky-600 text-white ring-2 ring-amber-300'
          : isNext
          ? 'bg-emerald-700/60 text-emerald-100 ring-1 ring-emerald-300/70'
          : 'bg-slate-800 text-slate-200';
        return (
          <span
            key={`${targetId}-${socketId}-${idx}`}
            className={`flex items-center gap-0.5 rounded px-1 text-[0.7rem] ${highlightClass}`}
          >
            <span className={`${roleColors(user.role)} font-semibold`}>
              {formatQueueUserLabel(user, selfId)}
            </span>
            {isCurrent && <span className="text-[0.65rem] text-slate-200">now</span>}
            {isNext && <span className="text-[0.65rem] text-emerald-100">next</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function QueueTargetRow({
  target,
  queue = [],
  currentId = null,
  nextId = null,
  selfId = null,
  lookupUser,
  canClick = false,
  pending = false,
  locked = false,
  lockedBlocked = false,
  privateOpen = false,
  buttonLabel = '',
  batteryLabel = '',
  batteryClassName = 'text-slate-400',
  timerLabel = '',
  thumbnailUrl = '',
  onRequest,
  showAction = true,
}) {
  const targetId = String(target?.id || '');
  const targetLabel = target?.label || target?.name || targetId;

  return (
    <li
      className={classNames(
        'surface flex flex-wrap items-start justify-between gap-0.5',
        canClick && 'cursor-pointer',
        locked
          ? 'bg-red-900/40'
          : privateOpen
          ? 'bg-amber-700/35 border border-amber-200/30'
          : null,
      )}
      onClick={() => {
        /*
          The whole row is a large target because queue selection is one of the
          main touch/click actions on the page. The caller still decides whether
          clicking is currently allowed, so disabled PTZ and locked rover states
          cannot accidentally request control through the shared renderer.
        */
        if (!canClick) return;
        onRequest?.(targetId);
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="h-8 w-10 shrink-0 rounded border border-slate-700 bg-black object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-0.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <p className="min-w-0 flex items-center gap-0.5 whitespace-nowrap text-slate-200">
              <RoverLabel
                rover={target?.rover || null}
                roverId={target?.roverId ?? targetId}
                name={targetLabel}
                color={target?.color || null}
                fallback={targetId}
              />
              {target?.description ? (
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-slate-400">
                  {target.description}
                </span>
              ) : null}
            </p>
            {timerLabel ? (
              <span className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-200">
                {timerLabel}
              </span>
            ) : null}
          </div>
          {batteryLabel ? (
            <span className={classNames('text-[0.75rem] font-semibold', batteryClassName)}>
              {batteryLabel}
            </span>
          ) : null}
        </div>
        <QueueUserChips
          targetId={targetId}
          queue={queue}
          currentId={currentId}
          nextId={nextId}
          selfId={selfId}
          lookupUser={lookupUser}
        />
      </div>
      {showAction ? (
        <button
          type="button"
          onClick={(event) => {
            /*
              Stop propagation so button clicks do not double-fire the row
              request. This keeps mouse, touch, and keyboard activation on the
              explicit button consistent with clicking the row background.
            */
            event.stopPropagation();
            onRequest?.(targetId);
          }}
          disabled={pending || lockedBlocked || !canClick}
          className={classNames(
            'button-dark disabled:opacity-40',
            locked && 'bg-red-600/70 text-white hover:bg-red-600',
          )}
        >
          {buttonLabel}
        </button>
      ) : null}
    </li>
  );
}
