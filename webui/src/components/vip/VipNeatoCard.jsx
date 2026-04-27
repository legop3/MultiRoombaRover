import { useMemo, useState } from 'react';

function normalizeState(value) {
  return String(value || '').trim();
}

function humanizeUiState(value) {
  const state = normalizeState(value);
  if (!state) return '--';
  if (state.includes('DOCKINGRUNNING')) return 'Returning';
  if (state.includes('PAUSED')) return 'Paused';
  if (state.includes('HOUSECLEANINGRUNNING')) return 'Cleaning House';
  if (state.includes('SPOTCLEANINGRUNNING')) return 'Spot Cleaning';
  if (state.includes('STATE_START')) return 'Starting';
  if (state.includes('STATE_IDLE')) return 'Idle';
  if (state.includes('STATE_STANDBY')) return 'Standby';
  return state;
}

function statusToneClass(tone) {
  if (tone === 'good') return 'border-emerald-200 bg-emerald-600 text-white';
  if (tone === 'warn') return 'border-amber-200 bg-amber-600 text-white';
  if (tone === 'danger') return 'border-rose-200 bg-rose-600 text-white';
  if (tone === 'info') return 'border-sky-200 bg-sky-600 text-white';
  return 'border-slate-200/30 bg-slate-700 text-slate-100';
}

function StatusRow({ label, value, tone = 'muted' }) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-1 py-0.5 text-xs ${statusToneClass(tone)}`}
    >
      <span className="font-semibold uppercase tracking-wide opacity-90">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function MetricCard({ label, value, tone = 'muted' }) {
  return (
    <div className={`rounded-lg border px-1 py-0.75 text-center ${statusToneClass(tone)}`}>
      <div className="text-[0.7rem] uppercase tracking-wide opacity-90">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function ActionPill({ label, tone = 'indigo' }) {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-200/70 bg-emerald-600/70 text-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200/70 bg-amber-600/70 text-amber-50'
        : 'border-indigo-200/70 bg-indigo-600/70 text-indigo-50';
  return (
    <span className={`rounded-full border px-0.5 py-0.15 text-[0.7rem] font-semibold ${toneClasses}`}>
      {label}
    </span>
  );
}

export default function VipNeatoCard({ neato, onStart, onSendHome, onLocate, fullWidth = false }) {
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const wrapClass = fullWidth ? 'w-full' : 'w-full max-w-xl';

  const configured = Boolean(neato?.configured);
  const connected = Boolean(neato?.enabled && neato?.connected);
  const docked = Boolean(neato?.telemetry?.extPowerPresent);
  const charging = Boolean(neato?.telemetry?.chargingActive);

  const uiStateLabel = humanizeUiState(neato?.telemetry?.uiState);
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

  const primaryAction = useMemo(() => {
    if (docked) {
      return {
        key: 'start',
        label: 'Start Cleaning',
        pending: 'Starting...',
        tone: 'emerald',
        canRun: canStart,
        fn: onStart,
        successMessage: 'Start cleaning command sent.',
      };
    }
    return {
      key: 'home',
      label: 'Send to Dock',
      pending: 'Sending...',
      tone: 'indigo',
      canRun: canSendHome,
      fn: onSendHome,
      successMessage: 'Send to dock command sent.',
    };
  }, [docked, canStart, onStart, canSendHome, onSendHome]);

  const canRunPrimary = configured && connected && primaryAction.canRun;
  const canRunLocate = configured && connected && canLocate;

  const runAction = async (key, fn, successMessage) => {
    if (!fn) return;
    setWorking(key);
    setMessage('');
    try {
      await fn();
      setMessage(successMessage);
    } catch (err) {
      setMessage(err?.message || 'Action failed.');
    } finally {
      setWorking('');
    }
  };

  const statusText = !configured
    ? 'Not configured'
    : !connected
      ? 'Offline'
      : 'Online';

  const statusTone = !configured ? 'warn' : !connected ? 'danger' : 'good';

  const batteryTone =
    battery == null ? 'muted' : battery >= 60 ? 'good' : battery >= 25 ? 'warn' : 'danger';

  return (
    <section className={`surface text-sm text-slate-200 ${wrapClass}`}>
      <div className="grid gap-0.5">
        <div className="flex items-center justify-between gap-0.5">
          <p className="text-sm font-semibold text-slate-100">Neato Control Surface (Gen3)</p>
          <ActionPill label={statusText} tone={connected ? 'emerald' : 'amber'} />
        </div>

        <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="rounded-xl border-2 border-indigo-300/70 bg-indigo-900 px-0.75 py-0.75">
            <div className="grid gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-0.5">
                <span className="text-base font-semibold text-indigo-50">
                  {docked ? 'Docked State' : 'Undocked State'}
                </span>
                <div className="flex flex-wrap gap-0.5">
                  <ActionPill label={docked ? 'Primary: Start' : 'Primary: Dock'} tone="indigo" />
                  <ActionPill label={uiStateLabel} tone="amber" />
                </div>
              </div>

              <p className="text-xs text-indigo-100/90">
                This Neato tile mirrors rover mode controls: one context-aware primary action based on dock state.
              </p>

              <button
                type="button"
                disabled={!canRunPrimary || Boolean(working)}
                onClick={() => runAction(primaryAction.key, primaryAction.fn, primaryAction.successMessage)}
                className={`w-full rounded-xl border-2 px-1 py-1 text-center text-base font-semibold text-white transition disabled:opacity-50 ${
                  primaryAction.tone === 'emerald'
                    ? 'border-emerald-200/70 bg-emerald-700 hover:bg-emerald-600'
                    : 'border-indigo-200/70 bg-indigo-700 hover:bg-indigo-600'
                }`}
              >
                {working === primaryAction.key ? primaryAction.pending : primaryAction.label}
              </button>

              <button
                type="button"
                disabled={!canRunLocate || Boolean(working)}
                onClick={() => runAction('locate', onLocate, 'Play sound command sent.')}
                className="w-full rounded-xl border-2 border-fuchsia-200/70 bg-fuchsia-700 px-1 py-0.75 text-center text-sm font-semibold text-fuchsia-50 transition hover:bg-fuchsia-600 disabled:opacity-50"
              >
                {working === 'locate' ? 'Playing...' : 'Play Sound'}
              </button>
            </div>
          </section>

          <section className="surface-muted px-0.5 py-0.5">
            <div className="grid gap-0.5">
              <StatusRow label="Connection" value={statusText} tone={statusTone} />
              <StatusRow label="Dock" value={docked ? 'On Base' : 'Away'} tone={docked ? 'info' : 'muted'} />
              <StatusRow label="Charging" value={charging ? 'Active' : 'Idle'} tone={charging ? 'info' : 'muted'} />
              <StatusRow label="UI State" value={uiStateLabel} tone="muted" />
            </div>
          </section>
        </div>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid gap-0.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Battery" value={batteryLabel} tone={batteryTone} />
            <MetricCard label="Voltage" value={voltageLabel} tone={voltage == null ? 'muted' : 'info'} />
            <MetricCard label="Docked" value={docked ? 'Yes' : 'No'} tone={docked ? 'info' : 'muted'} />
            <MetricCard label="Charging" value={charging ? 'Yes' : 'No'} tone={charging ? 'info' : 'muted'} />
            <MetricCard label="Error" value={hasError ? 'Yes' : 'No'} tone={hasError ? 'danger' : 'good'} />
            <MetricCard label="Alert" value={hasAlert ? 'Yes' : 'No'} tone={hasAlert ? 'warn' : 'good'} />
          </div>
        </section>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid gap-0.5">
            <StatusRow label="Robot Error" value={robotError} tone={hasError ? 'danger' : 'muted'} />
            <StatusRow label="Robot Alert" value={robotAlert} tone={hasAlert ? 'warn' : 'muted'} />
          </div>
        </section>

        {!configured || !connected || !primaryAction.canRun || !canLocate ? (
          <p className="text-xs text-slate-400 text-center">
            {!configured
              ? 'Set homeAssistant.neato.device in server config to enable Neato controls.'
              : !connected
                ? 'Home Assistant is offline.'
                : 'Waiting for required Neato entities in Home Assistant.'}
          </p>
        ) : null}

        {message ? <div className="text-xs text-slate-300 text-center">{message}</div> : null}
      </div>
    </section>
  );
}
