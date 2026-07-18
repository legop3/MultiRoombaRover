// Rover Queues Panel
// Purpose: Defines the Rover Queues Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSharedClock } from '../../hooks/useSharedClock.js';
import CardFrame from '../CardFrame/index.jsx';
import QueueTargetRow from '../QueueTargetRow/index.jsx';
import { trackAnalyticsEvent } from '../../analytics/index.js';
import { openExternalRover } from '../../lib/interInstanceTransfer.js';
import { ExternalInstancesCompact, InterInstancePopup } from '../InterInstancePanel/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import { useSettingsNamespace } from '../../settings/index.js';

function formatBattery(rover) {
  const percent = rover?.batteryState?.percentDisplay;
  if (percent == null) return '--';
  return `${percent}%`;
}

function batteryClass(rover) {
  if (!rover?.batteryState) return 'text-slate-400';
  if (rover.batteryState.urgentActive) return 'text-red-400';
  if (rover.batteryState.warnActive) return 'text-amber-300';
  return 'text-emerald-300';
}

function ScrollableQueueContent({ enabled = false, children }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const measureScrollRemainder = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    /*
      Fractional layout measurements can leave a sub-pixel remainder even at
      the bottom. The tolerance keeps the cue from flickering there while still
      showing it for any meaningful hidden queue content.
    */
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setCanScrollDown(remaining > 2);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;

    /*
      Queue membership, user chips, and remote instances all update from live
      session state and may change the content height without resizing the
      window. Observing both boxes keeps the overflow cue accurate without
      using JavaScript to calculate or assign the panel's actual height.
    */
    const observer = new ResizeObserver(measureScrollRemainder);
    observer.observe(viewport);
    observer.observe(content);
    const animationFrame = window.requestAnimationFrame(measureScrollRemainder);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [enabled, measureScrollRemainder]);

  if (!enabled) return children;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={measureScrollRemainder}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {canScrollDown ? (
        /*
          This indicator is deliberately removed from layout so it consumes no
          permanent panel height. It also adds no padding to the scroll content,
          keeping scrollHeight stable when the indicator disappears at the
          bottom. The explicit stacking level and opaque background keep queue
          cards from painting through or over the message.
        */
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-neutral-950 px-1 py-0.5 text-center text-xs font-semibold text-slate-200">
          Scroll for more ↓
        </div>
      ) : null}
    </div>
  );
}

export default function RoverQueuesPanel({
  title = 'Rovers',
  roster: rosterOverride = null,
  turnQueues: turnQueuesOverride = null,
  users: usersOverride = null,
  externalInstance = null,
  disabledOverlay = '',
  fillHeight = false,
}) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const localRoster = useSessionSelector((state) => state.session?.roster ?? []);
  const localTurnQueues = useSessionSelector((state) => state.session?.turnQueues ?? {});
  const localUsers = useSessionSelector((state) => state.session?.users ?? []);
  const interInstanceEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'interInstance'));
  const { value: pageSettings } = useSettingsNamespace('page', { interInstanceTransferSettings: true });
  const selfId = useSessionSelector((state) => state.session?.socketId || null);
  const assignedRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const assignedRoverName = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    if (!roverId) return '';
    const rover = (state.session?.roster || []).find((entry) => String(entry?.id) === roverId);
    return rover?.name || roverId;
  });
  const { requestControl, rebootOwnRover } = useSessionActions();
  const [pending, setPending] = useState({});
  const [rebootPending, setRebootPending] = useState(false);
  const [interInstancePopupOpen, setInterInstancePopupOpen] = useState(false);
  const externalMode = Boolean(externalInstance);
  const externalBlocked = Boolean(externalMode && disabledOverlay);
  const includeInterInstanceSettings = pageSettings?.interInstanceTransferSettings !== false;
  const roster = Array.isArray(rosterOverride) ? rosterOverride : localRoster;
  const turnQueues = turnQueuesOverride && typeof turnQueuesOverride === 'object' ? turnQueuesOverride : localTurnQueues;
  const users = Array.isArray(usersOverride) ? usersOverride : localUsers;

  const canRequest = useMemo(
    () => (externalMode ? !externalBlocked : role && role !== 'spectator'),
    [externalBlocked, externalMode, role],
  );
  const adminCapable = useMemo(
    () => role === 'admin' || role === 'lockdown',
    [role],
  );
  const hasDeadlines = useMemo(
    () => Object.values(turnQueues || {}).some((info) => info?.deadline || info?.idleDeadline),
    [turnQueues],
  );
  /*
    Queue timers are shown in whole seconds, and several queue panels can be
    mounted across desktop/mobile/spectator layouts. Sharing the one-second
    clock keeps those labels in sync while using a single interval globally.
  */
  const now = useSharedClock(1000, hasDeadlines);

  const rosterItems = useMemo(() => {
    const known = new Set(roster.map((rover) => String(rover.id)));
    const extra = Object.keys(turnQueues || {})
      .filter((id) => !known.has(String(id)))
      .map((id) => ({ id, name: id, locked: false, batteryState: null }));
    return [...roster, ...extra];
  }, [roster, turnQueues]);

  async function handleRequest(targetRoverId) {
    if (!targetRoverId) return;
    if (externalBlocked) return;
    if (externalMode) {
      /*
        External queue cards deliberately reuse the local row layout, but their
        action cannot go through this Socket.IO server. The row opens the remote
        instance and follows the saved Page setting for cookie/settings transfer
        instead of interrupting each click with a confirmation popup.
      */
      openExternalRover(externalInstance, targetRoverId, { includeSettings: includeInterInstanceSettings });
      return;
    }
    setPending((prev) => ({ ...prev, [targetRoverId]: true }));
    trackAnalyticsEvent('rover_queue_join', {
      roverId: targetRoverId,
      alreadyAssigned: assignedRoverId === String(targetRoverId),
    });
    try {
      await requestControl(targetRoverId);
      trackAnalyticsEvent('rover_queue_join_result', {
        roverId: targetRoverId,
        status: 'accepted',
      });
    } catch (err) {
      trackAnalyticsEvent('rover_queue_join_result', {
        roverId: targetRoverId,
        status: 'failed',
        reason: err?.message || 'unknown',
      });
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [targetRoverId]: false }));
    }
  }

  const lookupUser = (socketId) =>
    users.find((u) => u.socketId === socketId) || { socketId, nickname: null, role: null };

  async function handleRebootOwnRover() {
    if (rebootPending) return;
    const ok = window.confirm(`Reboot your rover "${assignedRoverName}" now?`);
    if (!ok) return;
    setRebootPending(true);
    trackAnalyticsEvent('rover_reboot_click', { roverId: assignedRoverId, scope: 'own_rover' });
    try {
      await rebootOwnRover();
      trackAnalyticsEvent('rover_reboot_result', { roverId: assignedRoverId, scope: 'own_rover', status: 'accepted' });
      alert('Reboot command sent.');
    } catch (err) {
      trackAnalyticsEvent('rover_reboot_result', {
        roverId: assignedRoverId,
        scope: 'own_rover',
        status: 'failed',
        reason: err?.message || 'unknown',
      });
      alert(err.message);
    } finally {
      setRebootPending(false);
    }
  }

  const rebootAction =
    role !== 'spectator' && assignedRoverId ? (
      <button
        type="button"
        onClick={handleRebootOwnRover}
        disabled={rebootPending}
        className="button-dark bg-amber-700/80 text-amber-50 hover:bg-amber-600 disabled:opacity-40"
        title="Reboot your assigned rover"
      >
        {rebootPending ? 'Rebooting...' : 'Reboot My Rover'}
      </button>
    ) : null;

  const headerActions = !externalMode ? rebootAction : null;

  return (
    <>
      <CardFrame
        title={title}
        actions={headerActions}
        fillHeight={fillHeight}
        bodyClassName="space-y-0.5 text-sm"
      >
        <ScrollableQueueContent enabled={fillHeight}>
          <div className="relative space-y-0.5">
            {rosterItems.length === 0 ? (
              <p className="text-sm text-slate-500">No rovers registered.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {rosterItems.map((rover) => {
                  const roverId = String(rover.id);
                  const info = turnQueues?.[roverId] || null;
                  const queue = info?.queue || [];
                  const deadline = info?.idleDeadline || info?.deadline || null;
                  const remainingSeconds =
                    deadline && deadline > now ? Math.ceil((deadline - now) / 1000) : deadline ? 0 : null;
                  const currentId = info?.current || null;
                  const currentIdx = currentId ? queue.findIndex((id) => id === currentId) : -1;
                  const nextId =
                    queue.length > 1
                      ? currentIdx >= 0
                        ? queue[(currentIdx + 1) % queue.length]
                        : queue[0]
                      : null;
                  const isSelfCurrent = Boolean(selfId && currentId && currentId === selfId);
                  const isSelfNext = Boolean(selfId && nextId && nextId === selfId);
                  const showTimer = remainingSeconds != null && (isSelfCurrent || isSelfNext);
                  const isPrivateOpen = Boolean(rover?.private?.enabled && rover?.private?.open);
                  const isGrantedClosedPrivate = Boolean(rover?.private?.enabled && !rover?.private?.open);
                  const locked = Boolean(rover.locked);
                  const lockedBlocked = locked && (externalMode || (!adminCapable && !isGrantedClosedPrivate));
                  const lockLabel = rover.lockReason ? `locked: ${rover.lockReason}` : 'locked';
                  const buttonLabel = pending[roverId]
                    ? '...'
                    : lockedBlocked
                    ? lockLabel
                    : externalMode
                    ? 'Open'
                    : 'request';
                  const canClickRow = canRequest && !lockedBlocked && !pending[roverId];
                  return (
                    <QueueTargetRow
                      key={rover.id}
                      target={{ ...rover, rover, roverId, id: roverId }}
                      queue={queue}
                      currentId={currentId}
                      nextId={nextId}
                      selfId={selfId}
                      lookupUser={lookupUser}
                      canClick={canClickRow}
                      pending={Boolean(pending[roverId])}
                      locked={locked}
                      lockedBlocked={lockedBlocked}
                      privateOpen={isPrivateOpen}
                      buttonLabel={buttonLabel}
                      batteryLabel={formatBattery(rover)}
                      batteryClassName={batteryClass(rover)}
                      timerLabel={showTimer ? (isSelfCurrent ? `${remainingSeconds}s left` : `Your turn in ${remainingSeconds}s`) : ''}
                      thumbnailUrl={externalMode ? rover?.snapshots?.latestUrl : ''}
                      onRequest={handleRequest}
                      showAction={Boolean(canRequest)}
                    />
                  );
                })}
              </ul>
            )}
            {externalBlocked ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-black/70 px-2 text-center text-sm font-semibold text-slate-100">
                {disabledOverlay}
              </div>
            ) : null}
            {!externalMode && interInstanceEnabled ? (
              <ExternalInstancesCompact onBrowse={() => setInterInstancePopupOpen(true)} />
            ) : null}
          </div>
        </ScrollableQueueContent>
      </CardFrame>
      {interInstancePopupOpen ? (
        /*
          The popup remains owned by the local Rover Queues panel because its
          title-bar action opens it. External queue panels never render that
          action, which prevents recursively opening browsers from remote rows.
        */
        <InterInstancePopup onClose={() => setInterInstancePopupOpen(false)} />
      ) : null}
    </>
  );
}
