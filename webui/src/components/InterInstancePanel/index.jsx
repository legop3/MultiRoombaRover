// Inter Instance Panel
// Purpose: Renders remote rover servers discovered through the inter-instance directory.
// Scope: Owns external server metadata presentation while reusing RoverQueuesPanel for rover/queue rows.
import { useMemo, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import CardFrame from '../CardFrame/index.jsx';
import RoverQueuesPanel from '../RoverQueuesPanel/index.jsx';
import { openExternalRoverWithPrompt } from '../../lib/interInstanceTransfer.js';
import { isFeatureEnabled } from '../../lib/features.js';

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
  if (mode === 'lockdown') return { blocked: true, label: 'Lockdown', overlay: 'This server is in lockdown', tone: 'red' };
  if (mode === 'admin') return { blocked: true, label: 'Admin only', overlay: 'This server is admin only', tone: 'amber' };
  if (mode === 'turns') return { blocked: false, label: 'Turns', tone: 'sky' };
  if (mode === 'open') return { blocked: false, label: 'Open', tone: 'emerald' };
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
    <div className="flex flex-wrap items-center gap-0.5 text-[0.7rem]">
      <span className={classNames('rounded px-1.5 py-0.5 text-xs font-semibold', statusClass(availability.tone))}>
        {availability.label}
      </span>
      {remote?.latencyMs != null ? (
        <span className="rounded bg-slate-800 px-1 text-slate-300">{remote.latencyMs}ms</span>
      ) : null}
    </div>
  );
}

function InstancePanel({ remote, children = null }) {
  const instance = remote?.instance || {};
  const features = featureEntries(instance.features);
  const color = instance.color || '#64748b';
  const availability = getRemoteAvailability(remote);
  return (
    <CardFrame
      title={instance.name || remote.url || 'External server'}
      bodyClassName="space-y-0.5 p-0.5 text-sm"
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} title={color} />

      <div className="space-y-0.5">
        <div className="flex items-start justify-between gap-0.5">
          <div className="min-w-0 flex-1 space-y-0.5">
            {instance.description ? <p className="text-slate-200">{instance.description}</p> : null}
          </div>
          <InstanceStatus remote={remote} />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-0.5">
            {instance.publicUrl ? <span className="truncate text-slate-400">{instance.publicUrl}</span> : null}
            <button type="button" className="button-dark" onClick={() => openExternalRoverWithPrompt(remote, '')}>
              Visit server
            </button>
          </div>
          {features.length ? (
            <div className="flex flex-wrap gap-0.5">
              {features.map((feature) => (
                <span key={feature} className="rounded bg-slate-800 px-1 text-[0.7rem] text-slate-200">
                  {feature}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[0.75rem] text-slate-500">No advertised feature flags.</p>
          )}
        </div>
      </div>
      {remote.online ? children : (
        /*
          Offline servers still belong in the same instance card so the large
          inter-instance UI has one visual unit per directory entry. Keeping the
          failure details here also avoids presenting a separate rover panel for
          a server that cannot currently provide one.
        */
        <div className="surface-muted space-y-0.5 text-sm">
          <p className="font-semibold text-slate-200">{availability.overlay}</p>
          <p className="break-all text-slate-400">{remote?.url || 'No URL available.'}</p>
          {remote?.lastError ? <p className="text-red-300">{remote.lastError}</p> : null}
        </div>
      )}
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
  const enabled = useInterInstanceEnabled();
  if (!enabled) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-0.5">
      <CardFrame
        title="External instances"
        actions={
          <button type="button" className="button-dark" onClick={onClose}>
            Close
          </button>
        }
        className="w-full max-w-6xl"
        bodyClassName="max-h-[82vh] overflow-y-auto p-0.5"
        clipOverflow={false}
      >
        <InterInstancePanel />
      </CardFrame>
    </div>
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
  return (
    <div className={classNames(
      'flex flex-wrap justify-center gap-0.5',
      centered && 'mx-auto w-full max-w-3xl',
    )}>
      {instances.map((remote) => (
        <div key={remote.url} className="w-full max-w-md flex-1 basis-80 space-y-0.5">
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
