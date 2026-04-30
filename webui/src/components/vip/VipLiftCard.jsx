// Vip Lift Card
// Purpose: Renders a shared lift controller panel synced from server session state.
// Scope: Presents verified-user controls while reflecting global busy/position/cooldown state.
import { useEffect, useMemo, useState } from 'react';

function badgeClass(tone) {
  if (tone === 'good') return 'bg-emerald-600 text-white';
  if (tone === 'warn') return 'bg-amber-500 text-slate-900';
  if (tone === 'danger') return 'bg-rose-600 text-white';
  return 'bg-slate-700 text-slate-100';
}

function positionLabel(value) {
  if (value === 'up') return 'Up';
  if (value === 'down') return 'Down';
  if (value === 'stopped') return 'Transitioning...';
  if (value === 'conflict') return 'Conflict';
  return '--';
}

export default function VipLiftCard({ lift, onUp, onDown, fullWidth = false }) {
  const [working, setWorking] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const wrapClass = fullWidth ? 'w-full' : 'w-full max-w-xl';

  const configured = Boolean(lift?.configured);
  const connected = Boolean(lift?.enabled && lift?.connected);
  const busy = Boolean(lift?.busy);
  const activeTarget = String(lift?.target || '').toLowerCase();
  const position = String(lift?.position || '').toLowerCase();
  const upAvailable = Boolean(lift?.availability?.upSwitch);
  const downAvailable = Boolean(lift?.availability?.downSwitch);
  const lastActionAt = Number(lift?.lastActionAt || 0);
  const commandCooldownMs = Math.max(0, Number(lift?.commandCooldownMs || 0));
  const cooldownRemainingMs = Math.max(0, lastActionAt + commandCooldownMs - nowMs);
  const cooldownActive = !busy && cooldownRemainingMs > 0;
  const blocked = busy || cooldownActive;

  useEffect(() => {
    if (!blocked) return undefined;
    const t = setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => clearInterval(t);
  }, [blocked]);

  useEffect(() => {
    setNowMs(Date.now());
  }, [lastActionAt, commandCooldownMs, busy]);

  const status = !configured ? 'Not configured' : !connected ? 'Offline' : blocked ? 'Busy' : 'Ready';
  const statusTone = !configured ? 'warn' : !connected ? 'danger' : blocked ? 'warn' : 'good';

  const canRun = configured && connected && !blocked && !working && upAvailable && downAvailable;
  const cooldownSeconds = useMemo(() => Math.ceil(cooldownRemainingMs / 1000), [cooldownRemainingMs]);

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
    <section className={`surface relative text-sm text-slate-200 ${wrapClass}`}>
      {blocked ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-slate-950/80 px-1.5 text-center">
          <div className="space-y-0.25">
            <p className="text-sm font-semibold text-slate-100">
              {busy ? 'Motion in progress' : 'Motion cooldown active'}
            </p>
            <p className="text-xs text-slate-300">
              Controls are disabled while the lift is moving, otherwise it's tiny brain would get confused.
            </p>
            {!busy && cooldownActive ? (
              <p className="text-xs text-slate-400">About {cooldownSeconds}s remaining.</p>
            ) : null}
          </div>
        </div>
      ) : null}
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
              className={`button-dark w-full text-sm disabled:opacity-50 ${position === 'down' || activeTarget === 'down' ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
            >
              {working === 'down' || activeTarget === 'down' ? 'Lowering...' : 'Down'}
            </button>
            <button
              type="button"
              disabled={!canRun}
              onClick={() => run('up', onUp)}
              className={`button-dark w-full text-sm disabled:opacity-50 ${position === 'up' || activeTarget === 'up' ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
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
