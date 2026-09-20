import { useCallback } from 'react';
import * as FaIcons from 'react-icons/fa';
import { FaCube, FaLock } from 'react-icons/fa';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext';
import CardFrame from '../CardFrame';
// Each control keeps its own JSX file; this panel only selects its renderer.
import ReadOnlyControl from './controls/ReadOnlyControl';
import ToggleControl from './controls/ToggleControl';
import NumberControl from './controls/NumberControl';
import TextControl from './controls/TextControl';
import SelectControl from './controls/SelectControl';
import ButtonControl from './controls/ButtonControl';

const controls = { readOnly: ReadOnlyControl, toggle: ToggleControl, number: NumberControl, text: TextControl, select: SelectControl, button: ButtonControl };


function ActivityTile({ entity, connected, allowed, admin }) {
  const { homeAssistantActivityAct } = useSessionActions();
  const onChange = useCallback((value) => homeAssistantActivityAct(entity.id, value), [homeAssistantActivityAct, entity.id]);
  // Resolve precisely the same Font Awesome names accepted by social links.
  // Unknown names remain usable with a neutral fallback rather than an error.
  const candidate = FaIcons[entity.icon?.trim()];
  const Icon = typeof candidate === 'function' ? candidate : FaCube;
  // Translucent fills preserve text contrast; an amber border still identifies
  // locked tiles regardless of the admin's chosen color.
  const color = /^#[0-9a-f]{6}$/i.test(entity.color) ? entity.color : '#3b82f6';
  const Control = controls[entity.type] || ReadOnlyControl;
  const disabled = !connected || !entity.available || !allowed || (entity.locked && !admin);
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border px-0.5 py-0.5"
    style={{ borderColor: entity.locked ? '#b45309' : `${color}aa`, backgroundColor: `${color}33` }}>
    <div className="-mx-0.5 -mt-0.5 flex min-h-5 min-w-0 items-center gap-0.5 rounded-t px-0.5 py-0.5 text-white" style={{ backgroundColor: `${color}66` }}>
      <Icon className="shrink-0 text-xs" aria-hidden="true" />
      <span title={entity.name} className="min-w-0 flex-1 truncate text-[0.78rem] font-semibold leading-none">{entity.name}</span>
      {entity.locked ? <span title={admin ? 'Locked for users; admins can still control' : 'Locked'} className="flex items-center gap-0.5 text-[0.65rem] text-amber-200"><FaLock aria-hidden="true" />Locked</span> : null}
    </div>
    {!entity.available && entity.type !== 'readOnly' ? <span className="text-xs text-amber-200">Unavailable</span> : null}
    <Control entity={entity} disabled={disabled} onChange={onChange} />
  </div>;
}

export default function HomeAssistantActivitiesPanel() {
  const state = useSessionSelector((session) => session.session?.homeAssistantActivities);
  const socketConnected = useSessionSelector((session) => session.connected);
  const role = useSessionSelector((session) => session.session?.role);
  const mode = useSessionSelector((session) => session.session?.mode);
  const admin = role === 'admin' || role === 'lockdown';
  const allowed = ['user', 'admin', 'lockdown'].includes(role) && (mode !== 'admin' || admin) && (mode !== 'lockdown' || role === 'lockdown');
  if (!state?.enabled || !state.items.length) return null;
  // Session data survives a browser disconnect. Disable immediately so local
  // debounce timers are cancelled even when HA itself remains connected.
  const connected = state.connected && socketConnected;
  // Reuse the room-control auto-fit grid and compact tile rhythm, while keeping
  // all data and commands in the Activities namespace on both device layouts.
  return <CardFrame title="Activity Controls" bodyClassName="space-y-0.5 text-sm"
    actions={<span className={`rounded-sm px-1 py-0.5 text-xs font-semibold leading-none ${connected ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}>{connected ? 'Connected' : 'Offline'}</span>}>
    {!connected ? <p className="px-0.5 text-xs text-amber-200">{socketConnected ? 'Home Assistant is offline.' : 'Server disconnected.'} Values may be out of date.</p> : null}
    {!allowed ? <p className="px-0.5 text-xs text-slate-400">Controls are read-only with your current access.</p> : null}
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] gap-0.5">
      {state.items.map((entity) => <ActivityTile key={entity.id} entity={entity} connected={connected} allowed={allowed} admin={admin} />)}
    </div>
  </CardFrame>;
}
