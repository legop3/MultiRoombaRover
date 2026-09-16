import { useCallback } from 'react';
import * as FaIcons from 'react-icons/fa';
import { FaCube, FaLock } from 'react-icons/fa';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext';
import CardFrame from '../CardFrame';
import ReadOnlyControl from './controls/ReadOnlyControl';
import ToggleControl from './controls/ToggleControl';
import ActionControls from './ActionControls';

function ActivityTile({ entity, connected, controlsReady, allowed, admin }) {
  const { homeAssistantActivityAct } = useSessionActions();
  const onAction = useCallback((action, values) => homeAssistantActivityAct(entity.id, action, values), [homeAssistantActivityAct, entity.id]);
  // Icon/color inputs follow social-link conventions. A translucent fill keeps
  // text legible even with bright colors and preserves the surrounding theme.
  const candidate = FaIcons[entity.icon?.trim()];
  const Icon = typeof candidate === 'function' ? candidate : FaCube;
  const color = /^#[0-9a-f]{6}$/i.test(entity.color) ? entity.color : '#3b82f6';
  const disabled = !connected || !controlsReady || !entity.available || !allowed || (entity.locked && !admin);
  const domain = entity.id.split('.')[0];
  const turnOn = entity.actions.find((action) => action.domain === domain && action.service === 'turn_on' && !action.fields.some((field) => field.required));
  const turnOff = entity.actions.find((action) => action.domain === domain && action.service === 'turn_off' && !action.fields.some((field) => field.required));
  const power = turnOn && turnOff;
  // Pair the universal on/off actions into one control. Other capabilities
  // continue to be rendered from metadata, including optional turn_on inputs.
  const actions = entity.actions.filter((action) => !(power && action.service === 'toggle'));
  return <div className="flex min-w-0 flex-col gap-0.5 rounded border px-0.5 py-0.5"
    style={{ borderColor: entity.locked ? '#b45309' : `${color}aa`, backgroundColor: `${color}33` }}>
    <div className="-mx-0.5 -mt-0.5 flex min-h-5 min-w-0 items-center gap-0.5 rounded-t px-0.5 py-0.5 text-white" style={{ backgroundColor: `${color}66` }}>
      <Icon className="shrink-0 text-xs" aria-hidden="true" />
      <span title={entity.name} className="min-w-0 flex-1 truncate text-[0.78rem] font-semibold leading-none">{entity.name}</span>
      {entity.locked ? <span title={admin ? 'Locked for users; admins can still control' : 'Locked'} className="flex items-center gap-0.5 text-[0.65rem] text-amber-200"><FaLock aria-hidden="true" />Locked</span> : null}
    </div>
    {/* On/off is already represented by the power control, and stateless
        actions need no misleading unknown-state label beside their button. */}
    {(!power || !['on', 'off'].includes(entity.state)) && (entity.state !== 'unknown' || !entity.actions.length || !entity.available)
      ? <ReadOnlyControl entity={entity} /> : null}
    {power ? <ToggleControl entity={{ name: `${entity.name}: Power`, state: !['off', 'unknown', 'unavailable'].includes(entity.state) }} disabled={disabled}
      onChange={(on) => onAction(on ? turnOn.id : turnOff.id, {})} /> : null}
    <div className="flex min-w-0 flex-wrap gap-0.5">
      {actions.map((action) => <ActionControls key={action.id} action={action} entityName={entity.name} disabled={disabled}
        onAction={onAction} hideButton={Boolean(power && (action === turnOn || action === turnOff))} />)}
    </div>
    {entity.unsupported.length ? <details className="text-[0.65rem] text-slate-400"><summary className="cursor-pointer">Other actions</summary>
      <p>These actions need inputs this panel cannot display: {entity.unsupported.join(', ')}.</p>
    </details> : null}
    {entity.details.length ? <details className="text-[0.65rem] text-slate-400"><summary className="cursor-pointer">Details</summary>
      {entity.details.map((detail) => <div key={detail.name} className="flex min-w-0 justify-between gap-1"><span>{detail.name}</span><span className="min-w-0 break-words text-right">{detail.value}</span></div>)}
    </details> : null}
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
  // Cancel local typing timers on either browser or HA disconnection; cached
  // session values are still useful to read but must not authorize new writes.
  const connected = state.connected && socketConnected;
  return <CardFrame title="Home Assistant" bodyClassName="space-y-0.5 text-sm"
    actions={<span className={`rounded px-1 py-0.5 text-xs font-semibold leading-none ${connected ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}>{connected ? 'Connected' : 'Offline'}</span>}>
    {!connected ? <p className="px-0.5 text-xs text-amber-200">{socketConnected ? 'Home Assistant is offline.' : 'Server disconnected.'} Values may be out of date.</p> : null}
    {connected && !state.controlsReady ? <p className="px-0.5 text-xs text-slate-400">Waiting for available controls.</p> : null}
    {!allowed ? <p className="px-0.5 text-xs text-slate-400">Controls are read-only with your current access.</p> : null}
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))] items-start gap-0.5">
      {state.items.map((entity) => <ActivityTile key={entity.id} entity={entity} connected={connected} controlsReady={state.controlsReady} allowed={allowed} admin={admin} />)}
    </div>
  </CardFrame>;
}
