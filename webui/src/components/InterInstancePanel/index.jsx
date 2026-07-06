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

function InstanceStatus({ remote }) {
  const mode = remote?.instance?.mode || 'unknown';
  const online = Boolean(remote?.online);
  return (
    <div className="flex flex-wrap items-center gap-0.5 text-[0.7rem]">
      <span className={classNames('rounded px-1', online ? 'bg-emerald-700/60 text-emerald-100' : 'bg-red-800/60 text-red-100')}>
        {online ? 'Online' : 'Offline'}
      </span>
      <span className="rounded bg-slate-800 px-1 text-slate-200">{mode}</span>
      {remote?.latencyMs != null ? (
        <span className="rounded bg-slate-800 px-1 text-slate-300">{remote.latencyMs}ms</span>
      ) : null}
    </div>
  );
}

function OfflineInstanceCard({ remote }) {
  const name = remote?.instance?.name || remote?.url || 'External server';
  return (
    <CardFrame title={name} meta="Offline" bodyClassName="space-y-0.5 p-0.5 text-sm">
      <p className="text-slate-400">{remote?.url || 'No URL available.'}</p>
      {remote?.lastError ? <p className="text-red-300">{remote.lastError}</p> : null}
    </CardFrame>
  );
}

function InstanceMetadata({ remote }) {
  const instance = remote?.instance || {};
  const features = featureEntries(instance.features);
  const color = instance.color || '#64748b';
  return (
    <CardFrame
      title={instance.name || remote.url || 'External server'}
      meta={<InstanceStatus remote={remote} />}
      bodyClassName="space-y-0.5 p-0.5 text-sm"
    >
      <div className="flex items-start gap-0.5">
        <span
          className="mt-0.5 h-4 w-4 shrink-0 rounded border border-white/20"
          style={{ backgroundColor: color }}
          title={color}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          {instance.description ? <p className="text-slate-200">{instance.description}</p> : null}
          <div className="flex flex-wrap items-center gap-0.5">
            {instance.publicUrl ? <span className="truncate text-slate-400">{instance.publicUrl}</span> : null}
            <button type="button" className="button-dark" onClick={() => openExternalRoverWithPrompt(remote, '')}>
              Open server
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
              />
            ) : (
              <OfflineInstanceCard key={remote.url} remote={remote} />
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
          <InstanceMetadata remote={remote} />
          {remote.online ? (
            <>
              <RemoteMediaStrip remote={remote} />
              <RoverQueuesPanel
                title={remote.instance?.name || remote.url}
                roster={remote.roster}
                turnQueues={remote.turnQueues}
                users={remote.users}
                externalInstance={remote}
              />
            </>
          ) : (
            <OfflineInstanceCard remote={remote} />
          )}
        </div>
      ))}
    </div>
  );
}
