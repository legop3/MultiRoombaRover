// Inter Instance Panel
// Purpose: Renders remote rover servers discovered through the inter-instance directory.
// Scope: Owns external server metadata presentation while reusing RoverQueuesPanel for rover/queue rows.
import { useMemo, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import CardFrame from '../CardFrame/index.jsx';
import RoverQueuesPanel from '../RoverQueuesPanel/index.jsx';
import { openExternalRover } from '../../lib/interInstanceTransfer.js';
import { isFeatureEnabled } from '../../lib/features.js';
import { useSettingsNamespace } from '../../settings/index.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function useRemoteInstances() {
  return useSessionSelector((state) => state.session?.interInstances?.instances ?? []);
}

function useInterInstanceEnabled() {
  return useSessionSelector((state) => isFeatureEnabled(state, 'interInstance'));
}

function featureEntries(features = {}) {
  return Object.entries(features || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name);
}

function getRemoteAvailability(remote) {
  const mode = remote?.instance?.mode || 'unknown';
  if (!remote?.online) return { blocked: true, label: 'Offline', overlay: 'This server is offline', tone: 'red' };
  if (mode === 'lockdown') return { blocked: true, label: 'Lockdown', overlay: 'This server is currently in lockdown mode', tone: 'red' };
  if (mode === 'admin') return { blocked: true, label: 'Admin only', overlay: 'This server is currently admin locked', tone: 'red' };
  if (mode === 'turns') return { blocked: false, label: 'Turns mode (open)', tone: 'emerald' };
  if (mode === 'open') return { blocked: false, label: 'Open mode', tone: 'emerald' };
  return { blocked: false, label: mode, tone: 'slate' };
}

function statusClass(tone) {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-700/70 text-emerald-50 ring-1 ring-emerald-300/50';
    case 'sky':
      return 'bg-sky-700/70 text-sky-50 ring-1 ring-sky-300/50';
    case 'amber':
      return 'bg-amber-600/80 text-amber-50 ring-1 ring-amber-200/60';
    case 'red':
      return 'bg-red-700/80 text-red-50 ring-1 ring-red-300/60';
    default:
      return 'bg-slate-700/80 text-slate-50 ring-1 ring-slate-400/40';
  }
}

function InstanceStatus({ remote }) {
  const availability = getRemoteAvailability(remote);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 text-[0.7rem]">
      <span className={classNames('rounded px-1.5 py-0.5 text-xs font-semibold', statusClass(availability.tone))}>
        {availability.label}
      </span>
    </div>
  );
}

function InstanceLatency({ remote }) {
  if (remote?.latencyMs == null) return null;
  return <span className="text-[0.7rem] font-normal text-slate-500">{remote.latencyMs}ms</span>;
}

function InstancePanel({ remote, children = null }) {
  const instance = remote?.instance || {};
  const features = featureEntries(instance.features);
  const color = instance.color || '#64748b';
  const online = Boolean(remote?.online);
  const { value: pageSettings } = useSettingsNamespace('page', { interInstanceTransferSettings: true });
  const includeSettings = pageSettings?.interInstanceTransferSettings !== false;
  return (
    <CardFrame
      title={instance.name || remote.url || 'External server'}
      meta={<InstanceLatency remote={remote} />}
      bodyClassName="space-y-0.5 p-0.5 text-sm"
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} title={color} />

      <div className="space-y-1">
        {/*
          The status is the main operational signal for a remote instance, so it
          stays beside the human-facing description where users naturally scan
          the server summary. Latency is intentionally moved to the title bar as
          quiet metadata because it is useful detail, not the primary decision.
        */}
        <div className="flex flex-wrap items-center justify-center gap-1 text-center">
          {online && instance.description ? <p className="min-w-0 text-slate-200">{instance.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 text-center">
          <InstanceStatus remote={remote} />
          <button
            type="button"
            className="button-dark"
            onClick={() => openExternalRover(remote, '', { includeSettings })}
          >
            Visit server
          </button>
        </div>

        {online && features.length ? (
          <div className="flex flex-wrap justify-center gap-0.5">
            {features.map((feature) => (
              <span key={feature} className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-200">
                {feature}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {online ? children : null}
    </CardFrame>
  );
}

function RemoteMediaStrip({ remote }) {
  const roomCameras = Array.isArray(remote.roomCameras) ? remote.roomCameras.filter((camera) => camera.snapshotUrl) : [];
  if (!roomCameras.length) return null;
  return (
    <div className="flex gap-0.5 overflow-x-auto pb-0.5">
      {roomCameras.map((camera) => (
        <div key={camera.id} className="surface-muted w-28 shrink-0 overflow-hidden">
          <img src={camera.snapshotUrl} alt={camera.name || camera.id} className="h-14 w-full bg-black object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

export function ExternalInstancesCompact() {
  const [expanded, setExpanded] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const enabled = useInterInstanceEnabled();
  const instances = useRemoteInstances();
  const visible = useMemo(() => instances.filter((remote) => remote?.online || remote?.url), [instances]);
  if (!enabled) return null;
  if (!visible.length) return null;
  return (
    <div className="space-y-0.5">
      <div className="grid grid-cols-2 gap-0.5">
        <button type="button" className="button-dark w-full" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide external' : `Show external (${visible.length})`}
        </button>
        <button type="button" className="button-dark w-full" onClick={() => setPopupOpen(true)}>
          Browse servers
        </button>
      </div>
      {expanded ? (
        <div className="space-y-0.5">
          {visible.map((remote) =>
            remote.online ? (
              <RoverQueuesPanel
                key={remote.url}
                title={remote.instance?.name || remote.url}
                roster={remote.roster}
                turnQueues={remote.turnQueues}
                users={remote.users}
                externalInstance={remote}
                disabledOverlay={getRemoteAvailability(remote).blocked ? getRemoteAvailability(remote).overlay : ''}
              />
            ) : (
              <InstancePanel key={remote.url} remote={remote} />
            ),
          )}
        </div>
      ) : null}
      {popupOpen ? <InterInstancePopup onClose={() => setPopupOpen(false)} /> : null}
    </div>
  );
}

export function InterInstancePopup({ onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-0.5">
      <InterInstanceBrowserFrame
        onClose={onClose}
        className="max-w-[calc(100vw-0.5rem)]"
        bodyClassName="max-h-[82vh] overflow-y-auto p-0.5"
      />
    </div>
  );
}

function InterInstanceCards({ instances, centered = false }) {
  return (
    <div className={classNames(
      'flex flex-wrap justify-center gap-0.5',
      centered && 'mx-auto w-full max-w-3xl',
    )}>
      {instances.map((remote) => (
        <div key={remote.url} className="w-80 max-w-full shrink-0 space-y-0.5">
          <InstancePanel remote={remote}>
            {/*
              The large browser should read as one card per external server:
              the server metadata, room snapshots, and the exact existing rover
              queues panel are grouped together here. RoverQueuesPanel keeps its
              own CardFrame and default title, so this component only controls
              where that already-existing panel is placed.
            */}
            <>
              <RemoteMediaStrip remote={remote} />
              <RoverQueuesPanel
                roster={remote.roster}
                turnQueues={remote.turnQueues}
                users={remote.users}
                externalInstance={remote}
                disabledOverlay={getRemoteAvailability(remote).blocked ? getRemoteAvailability(remote).overlay : ''}
              />
            </>
          </InstancePanel>
        </div>
      ))}
    </div>
  );
}

export function InterInstanceBrowserFrame({
  onClose = null,
  hideWhenEmpty = false,
  className = '',
  bodyClassName = 'p-0.5',
  centered = false,
}) {
  const enabled = useInterInstanceEnabled();
  const instances = useRemoteInstances();
  if (!enabled) return null;
  if (!instances.length && hideWhenEmpty) return null;
  const actions = onClose ? (
    <button type="button" className="button-dark" onClick={onClose}>
      Close
    </button>
  ) : null;
  /*
    This frame is shared by the popup and the admin/lockdown overlay. Keeping
    the wrapper here means those surfaces get the same external-instance card
    without placing it inside the login card or duplicating layout behavior.
  */
  return (
    <CardFrame
      title="External instances"
      actions={actions}
      className={className}
      bodyClassName={bodyClassName}
      clipOverflow={false}
    >
      {instances.length ? (
        <InterInstanceCards instances={instances} centered={centered} />
      ) : (
        <p className="text-sm text-slate-500">No external instances discovered.</p>
      )}
    </CardFrame>
  );
}

export default function InterInstancePanel({ compact = false, centered = false }) {
  const enabled = useInterInstanceEnabled();
  const instances = useRemoteInstances();
  if (!enabled) return null;
  if (compact) return <ExternalInstancesCompact />;
  if (!instances.length) {
    return (
      <CardFrame title="External instances" bodyClassName="p-0.5 text-sm">
        <p className="text-slate-500">No external instances discovered.</p>
      </CardFrame>
    );
  }
  return <InterInstanceCards instances={instances} centered={centered} />;
}
