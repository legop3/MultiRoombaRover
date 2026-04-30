// Vip Neato Card
// Purpose: Defines the Vip Neato Card module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';

function normalizeState(value) {
  return String(value || '').trim();
}

function humanizeUiState(value) {
  const state = normalizeState(value);
  if (!state) return '--';
  if (state.includes('DOCKINGRUNNING')) return 'Returning';
  if (state.includes('PAUSED')) return 'Paused';
  if (state.includes('HOUSECLEANINGRUNNING')) return 'Cleaning';
  if (state.includes('SPOTCLEANINGRUNNING')) return 'Spot cleaning';
  if (state.includes('STATE_START')) return 'Starting';
  if (state.includes('STATE_IDLE')) return 'Idle';
  if (state.includes('STATE_STANDBY')) return 'Idle';
  return state;
}

function metricToneClass(tone) {
  if (tone === 'good') return 'bg-emerald-600 text-white';
  if (tone === 'warn') return 'bg-amber-500 text-slate-900';
  if (tone === 'danger') return 'bg-rose-600 text-white';
  if (tone === 'info') return 'bg-sky-600 text-white';
  return 'bg-slate-700 text-slate-100';
}

function StatusTile({ label, value, tone = 'muted', valueClass = '' }) {
  return (
    <div className={`rounded-md px-1 py-0.75 text-center ${metricToneClass(tone)}`}>
      <div className="text-[0.72rem] opacity-90">{label}</div>
      <div className={`text-sm font-semibold ${valueClass}`} title={String(value || '')}>
        {value}
      </div>
    </div>
  );
}

export default function VipNeatoCard({
  neato,
  onStart,
  onSendHome,
  onLocate,
  onClearErrors,
  fullWidth = false,
}) {
  const [working, setWorking] = useState('');
  const wrapClass = fullWidth ? 'w-full' : 'w-full max-w-xl';

  const configured = Boolean(neato?.configured);
  const connected = Boolean(neato?.enabled && neato?.connected);
  const docked = Boolean(neato?.telemetry?.extPowerPresent);
  const charging = Boolean(neato?.telemetry?.chargingActive);

  const uiStateLabel = humanizeUiState(neato?.telemetry?.uiState);
  const uiStateRaw = normalizeState(neato?.telemetry?.uiState).toUpperCase();
  const battery = neato?.telemetry?.batteryPercent;
  const batteryLabel = Number.isFinite(battery) ? `${battery}%` : '--';
  const voltage = neato?.telemetry?.batteryVoltage;
  const voltageLabel = Number.isFinite(voltage) ? `${voltage.toFixed(2)} V` : '--';
  const robotError = normalizeState(neato?.telemetry?.robotError) || '--';
  const robotAlert = normalizeState(neato?.telemetry?.robotAlert) || '--';

  const hasError = robotError !== '--' && !/^no errors$/i.test(robotError) && !/^200/.test(robotError);
  const hasAlert = robotAlert !== '--' && !/^200/.test(robotAlert);

  const controls = neato?.controls || {};
  const canStart = Boolean(controls?.start?.available);
  const canSendHome = Boolean(controls?.sendHome?.available);
  const canLocate = Boolean(controls?.locate?.available);
  const canClearErrors = Boolean(controls?.clearErrors?.available);

  const primaryAction = useMemo(() => {
    const looksDockedByState = uiStateRaw.includes('STATE_IDLE') || uiStateRaw.includes('STATE_STANDBY');
    if (docked || looksDockedByState) {
      return {
        key: 'start',
        label: 'Start cleaning',
        pending: 'Starting...',
        toneClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
        canRun: canStart,
        fn: onStart,
      };
    }
    return {
      key: 'home',
      label: 'Send to dock',
      pending: 'Sending...',
      toneClass: 'bg-sky-600 hover:bg-sky-500 text-white',
      canRun: canSendHome,
      fn: onSendHome,
    };
  }, [docked, uiStateRaw, canStart, onStart, canSendHome, onSendHome]);

  const canRunPrimary = configured && connected && primaryAction.canRun;
  const canRunLocate = configured && connected && canLocate;
  const canRunClearErrors = configured && connected && canClearErrors;

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

  const primaryState = docked ? 'Docked' : uiStateLabel !== '--' ? uiStateLabel : 'Away from dock';

  return (
    <section className={`surface text-sm text-slate-200 ${wrapClass}`}>
      <div className="grid gap-0.5">
        <div className="relative flex items-center justify-center min-h-[1.5rem]">
          <div className="text-center">
            <p className="text-sm text-slate-100">Neato Controls</p>
            <p className="text-xs text-slate-400">Control the autonomous Neato robovac</p>
          </div>
          <span
            className={`absolute right-0 inline-flex w-auto rounded px-1 py-0.25 text-xs font-semibold ${metricToneClass(headerTone)}`}
          >
            {headerStatus}
          </span>
        </div>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0.5">
            <div className="grid gap-0.5">
              <div className="rounded-md bg-slate-800 px-1 py-0.75 text-center">
                <div className="text-xs text-slate-300">State</div>
                <div className="text-base font-semibold text-slate-100">{primaryState}</div>
              </div>
              <button
                type="button"
                disabled={!canRunPrimary || Boolean(working)}
                onClick={() => runAction(primaryAction.key, primaryAction.fn)}
                className={`rounded-md px-1 py-1 text-base font-semibold transition disabled:opacity-50 ${primaryAction.toneClass}`}
              >
                {working === primaryAction.key ? primaryAction.pending : primaryAction.label}
              </button>
            </div>
            <button
              type="button"
              disabled={!canRunLocate || Boolean(working)}
              onClick={() => runAction('locate', onLocate)}
              className="rounded-md bg-fuchsia-600 px-1 py-0.75 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
            >
              {working === 'locate' ? 'Playing...' : 'Play sound'}
            </button>
            <button
              type="button"
              disabled={!canRunClearErrors || Boolean(working)}
              onClick={() => runAction('clearErrors', onClearErrors)}
              className="rounded-md bg-amber-500 px-1 py-0.75 text-sm font-semibold text-slate-900 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {working === 'clearErrors' ? 'Clearing...' : 'Clear errors'}
            </button>
          </div>
        </section>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid gap-0.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
            <StatusTile label="Battery" value={batteryLabel} tone={batteryTone} />
            <StatusTile label="Voltage" value={voltageLabel} tone={voltage == null ? 'muted' : 'info'} />
            <StatusTile label="Docked" value={docked ? 'Yes' : 'No'} tone={docked ? 'info' : 'muted'} />
            <StatusTile label="Charging" value={charging ? 'Yes' : 'No'} tone={charging ? 'info' : 'muted'} />
            <StatusTile label="UI state" value={uiStateLabel} tone="muted" valueClass="truncate" />
            <StatusTile
              label="Robot error"
              value={robotError}
              tone={hasError ? 'danger' : 'muted'}
              valueClass="truncate"
            />
            <StatusTile
              label="Robot alert"
              value={robotAlert}
              tone={hasAlert ? 'warn' : 'muted'}
              valueClass="truncate"
            />
          </div>
        </section>

        {!configured || !connected || !primaryAction.canRun || !canLocate || !canClearErrors ? (
          <p className="text-xs text-slate-400 text-center">
            {!configured
              ? 'Set homeAssistant.neato.device in server config to enable Neato controls.'
              : !connected
                ? 'Home Assistant is offline.'
                : 'Waiting for required Neato entities in Home Assistant.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
