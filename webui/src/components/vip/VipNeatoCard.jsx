import { useMemo, useState } from 'react';

function normalizeState(value) {
  return String(value || '').trim();
}

function humanizeUiState(value) {
  const state = normalizeState(value);
  if (!state) return '--';
  if (state.includes('DOCKINGRUNNING')) return 'Returning';
  if (state.includes('PAUSED')) return 'Paused';
  if (state.includes('CLEANINGRUNNING')) return 'Cleaning';
  if (state.includes('STATE_START')) return 'Starting';
  if (state.includes('STATE_IDLE')) return 'Idle';
  if (state.includes('STATE_STANDBY')) return 'Standby';
  return state;
}

function badgeClass(active) {
  return active
    ? 'rounded bg-emerald-500 px-1 py-0.5 text-[0.7rem] font-semibold text-white'
    : 'rounded bg-slate-700 px-1 py-0.5 text-[0.7rem] font-semibold text-slate-200';
}

function StatusIndicator({ label, active, detail = '' }) {
  return (
    <div
      className={`rounded-md px-0.5 py-0.5 text-xs text-slate-100 ${
        active ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <div className="text-center font-medium">{label}</div>
      <div className="text-center text-[0.72rem] opacity-90">{detail || (active ? 'yes' : 'no')}</div>
    </div>
  );
}

export default function VipNeatoCard({ neato, onStart, onSendHome, onLocate, fullWidth = false }) {
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const wrapClass = fullWidth ? 'w-full' : 'w-full max-w-xl';

  const status = useMemo(() => {
    if (!neato?.enabled) {
      if (!neato?.configured) return 'Not configured';
      return 'Disabled';
    }
    if (!neato?.connected) return 'Offline';
    return 'Online';
  }, [neato?.configured, neato?.connected, neato?.enabled]);

  const canControl =
    Boolean(neato?.enabled) &&
    Boolean(neato?.connected) &&
    Boolean(neato?.controls?.start?.available) &&
    Boolean(neato?.controls?.sendHome?.available) &&
    Boolean(neato?.controls?.locate?.available);

  const uiStateLabel = humanizeUiState(neato?.telemetry?.uiState);
  const battery = neato?.telemetry?.batteryPercent;
  const batteryLabel = Number.isFinite(battery) ? `${battery}%` : '--';
  const voltage = neato?.telemetry?.batteryVoltage;
  const voltageLabel = Number.isFinite(voltage) ? `${voltage.toFixed(2)} V` : '--';
  const charging = Boolean(neato?.telemetry?.chargingActive);
  const docked = Boolean(neato?.telemetry?.extPowerPresent);
  const robotError = normalizeState(neato?.telemetry?.robotError) || '--';
  const robotAlert = normalizeState(neato?.telemetry?.robotAlert) || '--';
  const hasError = robotError !== '--' && !/^no errors$/i.test(robotError) && !/^200/.test(robotError);
  const hasAlert = robotAlert !== '--' && !/^200/.test(robotAlert);

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

  return (
    <section className={`surface text-sm text-slate-300 ${wrapClass}`}>
      <div className="grid gap-0.5">
        <div className="flex w-full items-center justify-between gap-0.5 text-left">
          <p className="text-sm text-slate-100">Neato Controls (Gen3)</p>
          <span className={badgeClass(status === 'Online')}>{status}</span>
        </div>

        <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-2">
          <section className="surface-muted h-full px-0.5 py-0.5">
            <div className="grid h-full gap-0.5 grid-rows-[auto_1fr]">
              <p className="text-sm text-slate-200 text-center">Robot Status</p>
              <div className="grid gap-0.5 content-start">
                <div className="rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-300">
                  <span className="font-semibold text-slate-100">UI State:</span> {uiStateLabel}
                </div>
                <div
                  className={`rounded px-1 py-0.5 text-xs ${
                    hasError ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'
                  }`}
                  title={robotError}
                >
                  <span className="font-semibold">Error:</span> {robotError}
                </div>
                <div
                  className={`rounded px-1 py-0.5 text-xs ${
                    hasAlert ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'
                  }`}
                  title={robotAlert}
                >
                  <span className="font-semibold">Alert:</span> {robotAlert}
                </div>
              </div>
            </div>
          </section>

          <section className="surface-muted h-full px-0.5 py-0.5">
            <div className="grid h-full gap-0.5 grid-rows-[auto_1fr]">
              <p className="text-sm text-slate-200 text-center">Power & Dock</p>
              <div className="grid gap-0.5 content-start grid-cols-2">
                <StatusIndicator label="Battery" active={battery != null} detail={batteryLabel} />
                <StatusIndicator label="Voltage" active={voltage != null} detail={voltageLabel} />
                <StatusIndicator label="Charging" active={charging} detail={charging ? 'active' : 'idle'} />
                <StatusIndicator label="Docked" active={docked} detail={docked ? 'on base' : 'away'} />
              </div>
            </div>
          </section>
        </div>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid gap-0.5">
            <p className="text-sm text-slate-200 text-center">Actions</p>
            <div className="grid w-full gap-0.5 grid-cols-1 sm:grid-cols-3">
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-emerald-500 px-1.5 py-1 text-base font-semibold text-white disabled:opacity-50"
                onClick={() => runAction('start', onStart, 'Start cleaning command sent.')}
                disabled={!canControl || Boolean(working)}
              >
                {working === 'start' ? 'Starting...' : 'Start Cleaning'}
              </button>
              <button
                type="button"
                className="rounded-md border border-sky-300 bg-sky-500 px-1.5 py-1 text-base font-semibold text-white disabled:opacity-50"
                onClick={() => runAction('home', onSendHome, 'Send to dock command sent.')}
                disabled={!canControl || Boolean(working)}
              >
                {working === 'home' ? 'Sending...' : 'Send to Dock'}
              </button>
              <button
                type="button"
                className="rounded-md border border-fuchsia-300 bg-fuchsia-500 px-1.5 py-1 text-base font-semibold text-white disabled:opacity-50"
                onClick={() => runAction('locate', onLocate, 'Play sound command sent.')}
                disabled={!canControl || Boolean(working)}
              >
                {working === 'locate' ? 'Playing...' : 'Play Sound'}
              </button>
            </div>
          </div>
        </section>

        {!canControl ? (
          <p className="text-xs text-slate-500 text-center">
            {!neato?.configured
              ? 'Set homeAssistant.neato.device in server config to enable Neato controls.'
              : !neato?.connected
              ? 'Home Assistant is offline.'
              : 'Waiting for required Neato entities in Home Assistant.'}
          </p>
        ) : null}

        {message ? <div className="text-xs text-slate-300 text-center">{message}</div> : null}
      </div>
    </section>
  );
}
