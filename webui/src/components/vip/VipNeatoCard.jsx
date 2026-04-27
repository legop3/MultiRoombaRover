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

function MetricCell({ label, value, tone = 'muted' }) {
  return (
    <div className={`rounded-md px-1 py-0.75 text-center ${metricToneClass(tone)}`}>
      <div className="text-[0.72rem] opacity-90">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function Row({ label, value, tone = 'muted' }) {
  return (
    <div className={`flex items-center justify-between rounded-md px-1 py-0.5 text-xs ${metricToneClass(tone)}`}>
      <span>{label}</span>
      <span className="font-semibold truncate pl-1" title={String(value || '')}>{value}</span>
    </div>
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
        label: 'Start cleaning',
        pending: 'Starting...',
        toneClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
        canRun: canStart,
        fn: onStart,
        successMessage: 'Start cleaning command sent.',
      };
    }
    return {
      key: 'home',
      label: 'Send to dock',
      pending: 'Sending...',
      toneClass: 'bg-sky-600 hover:bg-sky-500 text-white',
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

  const headerStatus = !configured ? 'Not configured' : !connected ? 'Offline' : 'Online';
  const headerTone = !configured ? 'warn' : !connected ? 'danger' : 'good';

  const batteryTone =
    battery == null ? 'muted' : battery >= 60 ? 'good' : battery >= 25 ? 'warn' : 'danger';

  const primaryState = docked ? 'Docked' : uiStateLabel !== '--' ? uiStateLabel : 'Away from dock';

  return (
    <section className={`surface text-sm text-slate-200 ${wrapClass}`}>
      <div className="grid gap-0.5">
        <div className="flex items-center justify-between gap-0.5">
          <p className="text-sm text-slate-100">Neato</p>
          <span className={`rounded px-1 py-0.25 text-xs font-semibold ${metricToneClass(headerTone)}`}>
            {headerStatus}
          </span>
        </div>

        <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="surface-muted px-0.5 py-0.5">
            <div className="grid gap-0.5">
              <div className="rounded-md bg-slate-800 px-1 py-0.75 text-center">
                <div className="text-xs text-slate-300">State</div>
                <div className="text-base font-semibold text-slate-100">{primaryState}</div>
              </div>

              <button
                type="button"
                disabled={!canRunPrimary || Boolean(working)}
                onClick={() => runAction(primaryAction.key, primaryAction.fn, primaryAction.successMessage)}
                className={`rounded-md px-1 py-1 text-base font-semibold transition disabled:opacity-50 ${primaryAction.toneClass}`}
              >
                {working === primaryAction.key ? primaryAction.pending : primaryAction.label}
              </button>

              <button
                type="button"
                disabled={!canRunLocate || Boolean(working)}
                onClick={() => runAction('locate', onLocate, 'Play sound command sent.')}
                className="rounded-md bg-fuchsia-600 px-1 py-0.75 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
              >
                {working === 'locate' ? 'Playing...' : 'Play sound'}
              </button>
            </div>
          </section>

          <section className="surface-muted px-0.5 py-0.5">
            <div className="grid gap-0.5 grid-cols-2">
              <MetricCell label="Battery" value={batteryLabel} tone={batteryTone} />
              <MetricCell label="Voltage" value={voltageLabel} tone={voltage == null ? 'muted' : 'info'} />
              <MetricCell label="Docked" value={docked ? 'Yes' : 'No'} tone={docked ? 'info' : 'muted'} />
              <MetricCell label="Charging" value={charging ? 'Yes' : 'No'} tone={charging ? 'info' : 'muted'} />
            </div>
          </section>
        </div>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid gap-0.5">
            <Row label="UI state" value={uiStateLabel} tone="muted" />
            <Row label="Robot error" value={robotError} tone={hasError ? 'danger' : 'muted'} />
            <Row label="Robot alert" value={robotAlert} tone={hasAlert ? 'warn' : 'muted'} />
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
