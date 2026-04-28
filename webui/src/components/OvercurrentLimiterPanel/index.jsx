import { useMemo } from 'react';
import { useControlSystem } from '../../controls/index.js';
import { OVERCURRENT_GROUPS } from '../../controls/overcurrentLimiter.js';

const GROUP_LABELS = {
  drive: 'Drive wheels',
  aux: 'Aux motors',
};

function formatPct(value) {
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value * 100)}%`;
}

function ProgressBar({ value, color = 'bg-emerald-500' }) {
  const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
      <div className={`h-full ${color}`} style={{ width }} />
    </div>
  );
}

export default function OvercurrentLimiterPanel() {
  const {
    state: { roverId },
    overcurrentLimiter,
  } = useControlSystem();
  const groups = useMemo(() => OVERCURRENT_GROUPS.map((group) => group.key), []);

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Overcurrent limiter</span>
        <span>{overcurrentLimiter?.adminImmune ? 'Admin immune' : 'Active'}</span>
      </div>
      {!roverId ? (
        <p className="text-xs text-slate-500">Assign a rover to view limiter status.</p>
      ) : (
        <div className="space-y-0.5">
          {groups.map((key) => {
            const cap = overcurrentLimiter?.caps?.[key]?.cap ?? 0;
            const over = overcurrentLimiter?.overcurrent?.groups?.[key] ?? false;
            const scale = overcurrentLimiter?.scales?.perGroup?.[key] ?? 1;
            return (
              <div key={key} className="surface space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-200">{GROUP_LABELS[key] || key}</span>
                  <span className={over ? 'text-red-300' : 'text-slate-400'}>
                    {over ? 'overcurrent' : 'ok'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                    <span>Cap</span>
                    <span>{formatPct(cap)}</span>
                  </div>
                  <ProgressBar value={cap} color="bg-amber-500" />
                  <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                    <span>Scale</span>
                    <span>{formatPct(scale)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="surface text-[0.7rem] text-slate-400">
            <div>{`Down rate ${overcurrentLimiter?.config?.downRatePerSec}/s · Up rate ${overcurrentLimiter?.config?.upRatePerSec}/s`}</div>
            <div>{`Release delay ${overcurrentLimiter?.config?.releaseDelaySec}s`}</div>
            <div>{`Output rate ${overcurrentLimiter?.config?.outputRateMs}ms`}</div>
          </div>
        </div>
      )}
    </section>
  );
}
