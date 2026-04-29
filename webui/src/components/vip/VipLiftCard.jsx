// Vip Lift Card
// Purpose: Renders a shared lift controller panel synced from server session state.
// Scope: Presents verified-user controls while reflecting global busy/position/cooldown state.
import { useState } from 'react';

function badgeClass(tone) {
  if (tone === 'good') return 'bg-emerald-600 text-white';
  if (tone === 'warn') return 'bg-amber-500 text-slate-900';
  if (tone === 'danger') return 'bg-rose-600 text-white';
  return 'bg-slate-700 text-slate-100';
}

function positionLabel(value) {
  if (value === 'up') return 'Up';
  if (value === 'down') return 'Down';
  if (value === 'stopped') return 'Stopped';
  if (value === 'conflict') return 'Conflict';
  return '--';
}

export default function VipLiftCard({ lift, onUp, onDown, fullWidth = false }) {
  const [working, setWorking] = useState('');
  const wrapClass = fullWidth ? 'w-full' : 'w-full max-w-xl';

  const configured = Boolean(lift?.configured);
  const connected = Boolean(lift?.enabled && lift?.connected);
  const busy = Boolean(lift?.busy);
  const activeTarget = String(lift?.target || '').toLowerCase();
  const position = String(lift?.position || '').toLowerCase();
  const upAvailable = Boolean(lift?.availability?.upSwitch);
  const downAvailable = Boolean(lift?.availability?.downSwitch);

  const status = !configured ? 'Not configured' : !connected ? 'Offline' : busy ? 'Busy' : 'Ready';
  const statusTone = !configured ? 'warn' : !connected ? 'danger' : busy ? 'warn' : 'good';

  const canRun = configured && connected && !busy && !working && upAvailable && downAvailable;

  const run = async (dir, fn) => {
    if (!fn) return;
    setWorking(dir);
    try {
      await fn();
    } catch {
      // Errors are surfaced by shared state and command ack handling.
    } finally {
      setWorking('');
    }
  };

  return (
    <section className={`surface text-sm text-slate-200 ${wrapClass}`}>
      <div className="grid gap-0.5">
        <div className="relative flex items-center justify-center min-h-[1.5rem]">
          <div className="text-center">
            <p className="text-sm text-slate-100">Lift Controls</p>
            <p className="text-xs text-slate-400">Move the lift up and down. Please don't break anything...</p>
          </div>
          <span
            className={`absolute right-0 inline-flex w-auto rounded px-1 py-0.25 text-xs font-semibold ${badgeClass(statusTone)}`}
          >
            {status}
          </span>
        </div>

        <section className="surface-muted px-0.5 py-0.5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0.5">
            <div className="rounded-md bg-slate-800 px-1 py-0.75 text-center">
              <div className="text-xs text-slate-300">Position</div>
              <div className="text-base font-semibold text-slate-100">{positionLabel(position)}</div>
            </div>
            <button
              type="button"
              disabled={!canRun}
              onClick={() => run('down', onDown)}
              className={`rounded-md px-1 py-0.75 text-base font-semibold transition disabled:opacity-50 ${position === 'down' || activeTarget === 'down' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-100 hover:bg-slate-600'}`}
            >
              {working === 'down' || activeTarget === 'down' ? 'Lowering...' : 'Down'}
            </button>
            <button
              type="button"
              disabled={!canRun}
              onClick={() => run('up', onUp)}
              className={`rounded-md px-1 py-0.75 text-base font-semibold transition disabled:opacity-50 ${position === 'up' || activeTarget === 'up' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-100 hover:bg-slate-600'}`}
            >
              {working === 'up' || activeTarget === 'up' ? 'Raising...' : 'Up'}
            </button>
          </div>
        </section>

        {!configured || !connected || !upAvailable || !downAvailable ? (
          <p className="text-xs text-slate-400 text-center">
            {!configured
              ? 'Set homeAssistant.lift.upSwitch and homeAssistant.lift.downSwitch in server config.'
              : !connected
                ? 'Home Assistant is offline.'
                : 'Waiting for required lift switch entities in Home Assistant.'}
          </p>
        ) : null}

        {lift?.lastError ? <p className="text-xs text-rose-300 text-center">Last error: {lift.lastError}</p> : null}
      </div>
    </section>
  );
}
