// Neato Card
// Purpose: Defines the public Neato activity card and the local helpers/components used in this file.
// Scope: Keeps Neato state display and commands together because each button's availability depends on the same shared robot telemetry.
import { useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import CardFrame from '../CardFrame/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';

function normalizeState(value) {
  return String(value || '').trim();
}

function displayRawState(value) {
  // Only substitute a placeholder when Home Assistant supplied no value at all.
  // Otherwise preserve the complete string so the status panel is a faithful
  // view of BrainSlug output, including identifiers unknown to this frontend.
  if (value == null || value === '') return '--';
  return String(value);
}

function metricToneClass(tone) {
  if (tone === 'good') return 'bg-emerald-600 text-white';
  if (tone === 'warn') return 'bg-amber-500 text-slate-900';
  if (tone === 'danger') return 'bg-rose-600 text-white';
  return 'bg-slate-700 text-slate-100';
}

function StatusTile({ label, value, tone = 'muted', valueClass = '', hideLabel = false }) {
  return (
    <div className={`rounded-md px-1 py-0.75 text-center ${metricToneClass(tone)}`}>
      {!hideLabel ? <div className="text-[0.72rem] opacity-90">{label}</div> : null}
      <div className={`text-sm font-semibold ${valueClass}`} title={String(value || '')}>
        {value}
      </div>
    </div>
  );
}

export default function NeatoCard() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'neato'));

  /*
    Neato support is optional hardware surfaced through Home Assistant. Keeping
    the feature gate in this card avoids scattered checks in each route layout.
  */
  if (!enabled) return null;

  return <NeatoCardContent />;
}

function NeatoCardContent() {
  /*
    Neato is a standalone public activity card. It owns its session selector and
    command actions so callers do not need to know the socket event names or
    keep a parallel list of Neato props in every tab layout.
  */
  const neato = useSessionSelector((state) => state.session?.neato || null);
  const {
    neatoStart,
    neatoSendHome,
    neatoLocate,
    neatoClearErrors,
    neatoPowerCycle,
    neatoSetNavigationMode,
  } = useSessionActions();
  const [working, setWorking] = useState('');

  const configured = Boolean(neato?.configured);
  const connected = Boolean(neato?.enabled && neato?.connected);
  const docked = Boolean(neato?.telemetry?.extPowerPresent);
  const charging = Boolean(neato?.telemetry?.chargingActive);

  // These values deliberately stay raw. BrainSlug owns their meaning, and a
  // partial frontend translation would create a second, potentially incorrect
  // state model instead of showing what the robot actually reported.
  const uiStateRaw = displayRawState(neato?.telemetry?.uiState);
  const robotStateRaw = displayRawState(neato?.telemetry?.robotState);
  const battery = neato?.telemetry?.batteryPercent;
  const batteryLabel = Number.isFinite(battery) ? `${battery}%` : '--';
  const voltage = neato?.telemetry?.batteryVoltage;
  const voltageLabel = Number.isFinite(voltage) ? `${voltage.toFixed(2)} V` : '--';
  const robotError = displayRawState(neato?.telemetry?.robotError);
  const robotAlert = displayRawState(neato?.telemetry?.robotAlert);

  const controls = neato?.controls || {};
  const canStart = Boolean(controls?.start?.available);
  const canSendHome = Boolean(controls?.sendHome?.available);
  const canLocate = Boolean(controls?.locate?.available);
  const canClearErrors = Boolean(controls?.clearErrors?.available);
  const canPowerCycle = Boolean(controls?.powerCycle?.available);
  const navigationMode = controls?.navigationMode || {};
  const canSetNavigationMode = Boolean(navigationMode.available);
  const navigationModeValue = normalizeState(navigationMode.value);
  const navigationModeOptions = Array.isArray(navigationMode.options) ? navigationMode.options : [];

  const canRunStart = configured && connected && canStart;
  const canRunSendHome = configured && connected && canSendHome;
  const canRunLocate = configured && connected && canLocate;
  const canRunClearErrors = configured && connected && canClearErrors;
  const canRunPowerCycle = configured && connected && canPowerCycle;
  const canRunNavigationMode = configured && connected && canSetNavigationMode;

  const runAction = async (key, fn) => {
    if (!fn) return;
    setWorking(key);
    try {
      await fn();
    } catch {
      // Keep UI minimal; errors are intentionally silent in-panel.
    } finally {
      setWorking('');
    }
  };

  const headerStatus = !configured ? 'Not configured' : !connected ? 'Offline' : 'Online';
  const headerTone = !configured ? 'warn' : !connected ? 'danger' : 'good';

  const batteryTone =
    battery == null ? 'muted' : battery >= 60 ? 'good' : battery >= 25 ? 'warn' : 'danger';

  return (
    <CardFrame
      title="Neato Controls"
     
      className="w-full"
      bodyClassName="text-sm text-slate-200"
      actions={
        <span className={`inline-flex w-auto rounded px-1 py-0.25 text-xs font-semibold ${metricToneClass(headerTone)}`}>
          {headerStatus}
        </span>
      }
    >
      <div className="grid gap-0.5">
        <div className="text-center">
          <p className="text-xs text-slate-400">Control the autonomous Neato robovac. Be nice to him.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0.5">
          <div className="surface-muted grid gap-0.5">
            <p className="text-xs text-slate-300 text-center">Controls</p>
            <button
              type="button"
              disabled={!canRunStart || Boolean(working)}
              onClick={() => runAction('start', neatoStart)}
              className="rounded-md border border-sky-300 bg-emerald-600 px-1 py-1 text-base font-semibold text-white transition hover:border-sky-500 hover:bg-emerald-500 disabled:opacity-50"
            >
              {working === 'start' ? 'Starting...' : 'Start cleaning'}
            </button>
            <button
              type="button"
              disabled={!canRunSendHome || Boolean(working)}
              onClick={() => runAction('sendHome', neatoSendHome)}
              className="rounded-md border border-sky-300 bg-sky-600 px-1 py-1 text-base font-semibold text-white transition hover:border-sky-500 hover:bg-sky-500 disabled:opacity-50"
            >
              {working === 'sendHome' ? 'Sending...' : 'Send to dock'}
            </button>
            <div className="grid grid-cols-3 gap-0.5">
              <button
                type="button"
                disabled={!canRunLocate || Boolean(working)}
                onClick={() => runAction('locate', neatoLocate)}
                className="w-full rounded-md border border-sky-300 bg-fuchsia-600 px-1 py-0.5 text-xs font-semibold text-white transition hover:border-sky-500 hover:bg-fuchsia-500 disabled:opacity-50"
              >
                {working === 'locate' ? 'Playing...' : 'Play sound'}
              </button>
              <button
                type="button"
                disabled={!canRunClearErrors || Boolean(working)}
                onClick={() => runAction('clearErrors', neatoClearErrors)}
                className="w-full rounded-md border border-sky-300 bg-amber-500 px-1 py-0.5 text-xs font-semibold text-slate-900 transition hover:border-sky-500 hover:bg-amber-400 disabled:opacity-50"
              >
                {working === 'clearErrors' ? 'Clearing...' : 'Clear errors'}
              </button>
              <button
                type="button"
                disabled={!canRunPowerCycle || Boolean(working)}
                onClick={() => runAction('powerCycle', neatoPowerCycle)}
                className="w-full rounded-md border border-rose-300 bg-rose-600 px-1 py-0.5 text-xs font-semibold text-white transition hover:border-rose-500 hover:bg-rose-500 disabled:opacity-50"
              >
                {working === 'powerCycle' ? 'Cycling...' : 'Power cycle'}
              </button>
            </div>
            <div className="surface-muted grid gap-0.5 pt-0.25">
              <label className="grid gap-0.25 text-xs text-slate-300">
                <span className="text-center">Navigation mode</span>
                <select
                  value={navigationModeValue}
                  disabled={!canRunNavigationMode || Boolean(working)}
                  onChange={(event) => runAction(
                    'navigationMode',
                    () => neatoSetNavigationMode(event.target.value),
                  )}
                  className="field-input w-full text-sm disabled:opacity-50"
                >
                  {!navigationModeOptions.includes(navigationModeValue) ? (
                    <option value="">--</option>
                  ) : null}
                  {navigationModeOptions.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="surface-muted grid gap-0.5 pt-0.25">
              <p className="text-xs text-slate-300 text-center">Power status</p>
              <div className="grid grid-cols-2 gap-0.5">
                <StatusTile label="Battery" value={batteryLabel} tone={batteryTone} />
                <StatusTile label="Voltage" value={voltageLabel} tone="muted" />
                <StatusTile
                  label="Docked"
                  value={docked ? 'Docked' : 'Not docked'}
                  tone={docked ? 'good' : 'muted'}
                  hideLabel
                />
                <StatusTile
                  label="Charging"
                  value={charging ? 'charging' : 'not charging'}
                  tone={charging ? 'good' : 'muted'}
                  hideLabel
                />
              </div>
            </div>
          </div>

          <div className="grid gap-0.5">
            <div className="surface-muted grid gap-0.5">
              <p className="text-xs text-slate-300 text-center">Robot Status</p>
              <div className="grid gap-0.5">
                <div className="rounded-md bg-slate-800 px-1 py-0.5">
                  <div className="text-[0.72rem] text-slate-300">Robot alert</div>
                  <div className="font-mono text-sm text-slate-100 break-all">{robotAlert}</div>
                </div>
                <div className="rounded-md bg-slate-800 px-1 py-0.5">
                  <div className="text-[0.72rem] text-slate-300">Robot error</div>
                  <div className="font-mono text-sm text-slate-100 break-all">{robotError}</div>
                </div>
                <div className="rounded-md bg-slate-800 px-1 py-0.5">
                  <div className="text-[0.72rem] text-slate-300">Robot state</div>
                  <div className="font-mono text-sm text-slate-100 break-all">{robotStateRaw}</div>
                </div>
                <div className="rounded-md bg-slate-800 px-1 py-0.5">
                  <div className="text-[0.72rem] text-slate-300">UI state</div>
                  <div className="font-mono text-sm text-slate-100 break-all">{uiStateRaw}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!configured || !connected || !canStart || !canSendHome || !canLocate || !canClearErrors || !canPowerCycle ? (
          <p className="text-xs text-slate-400 text-center">
            {!configured
              ? 'Set homeAssistant.neato.device in server config to enable Neato controls.'
              : !connected
                ? 'Home Assistant is offline.'
                : 'Waiting for required Neato entities in Home Assistant.'}
          </p>
        ) : null}
      </div>
    </CardFrame>
  );
}
