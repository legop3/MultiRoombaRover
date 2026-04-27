import { useMemo, useState } from 'react';
import { innerFlowClass } from './constants.js';

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
    ? 'rounded bg-emerald-600/80 px-1 py-0.5 text-[0.7rem] font-semibold text-white'
    : 'rounded bg-slate-700 px-1 py-0.5 text-[0.7rem] font-semibold text-slate-200';
}

export default function VipNeatoCard({
  neato,
  onStart,
  onSendHome,
  onLocate,
  onMessage,
  fullWidth = false,
}) {
  const [working, setWorking] = useState('');
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

  const runAction = async (key, fn, successMessage) => {
    if (!fn) return;
    setWorking(key);
    onMessage?.('');
    try {
      await fn();
      onMessage?.(successMessage);
    } catch (err) {
      onMessage?.(err?.message || 'Action failed.');
    } finally {
      setWorking('');
    }
  };

  return (
    <section className={`surface text-sm text-slate-300 ${wrapClass}`}>
      <div className={innerFlowClass}>
        <div className="flex w-full items-center justify-between gap-0.5 text-left">
          <p className="text-sm text-slate-100">Neato (Gen3)</p>
          <span className={badgeClass(status === 'Online')}>{status}</span>
        </div>

        <div className="grid w-full grid-cols-2 gap-0.5 text-xs">
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>UI State</span>
            <span className="font-semibold text-slate-100">{uiStateLabel}</span>
          </div>
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>Battery</span>
            <span className="font-semibold text-slate-100">{batteryLabel}</span>
          </div>
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>Docked</span>
            <span className="font-semibold text-slate-100">{docked ? 'Yes' : 'No'}</span>
          </div>
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>Charging</span>
            <span className="font-semibold text-slate-100">{charging ? 'Yes' : 'No'}</span>
          </div>
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>Voltage</span>
            <span className="font-semibold text-slate-100">{voltageLabel}</span>
          </div>
          <div className="surface-muted flex items-center justify-between px-1 py-0.5">
            <span>Error</span>
            <span className="truncate pl-1 font-semibold text-slate-100" title={robotError}>{robotError}</span>
          </div>
          <div className="surface-muted col-span-2 flex items-center justify-between px-1 py-0.5">
            <span>Alert</span>
            <span className="truncate pl-1 font-semibold text-slate-100" title={robotAlert}>{robotAlert}</span>
          </div>
        </div>

        <div className="flex w-full justify-center gap-0.5">
          <button
            type="button"
            className="button-dark text-sm disabled:opacity-50"
            onClick={() => runAction('start', onStart, 'Neato start sent.')}
            disabled={!canControl || Boolean(working)}
          >
            {working === 'start' ? 'Starting...' : 'Start'}
          </button>
          <button
            type="button"
            className="button-dark text-sm disabled:opacity-50"
            onClick={() => runAction('home', onSendHome, 'Neato send-home sent.')}
            disabled={!canControl || Boolean(working)}
          >
            {working === 'home' ? 'Sending...' : 'Send Home'}
          </button>
          <button
            type="button"
            className="button-dark text-sm disabled:opacity-50"
            onClick={() => runAction('locate', onLocate, 'Neato locate sent.')}
            disabled={!canControl || Boolean(working)}
          >
            {working === 'locate' ? 'Locating...' : 'Locate Robot'}
          </button>
        </div>

        {!canControl ? (
          <p className="text-xs text-slate-500 text-center">
            {!neato?.configured
              ? 'Set homeAssistant.neato.device in server config to enable Neato controls.'
              : !neato?.connected
              ? 'Home Assistant is offline.'
              : 'Waiting for required Neato entities in Home Assistant.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
