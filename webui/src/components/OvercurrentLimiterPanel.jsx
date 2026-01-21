import { useMemo } from 'react';
import { useControlSystem } from '../controls/index.js';

const MOTOR_LABELS = {
  leftWheel: 'Left wheel',
  rightWheel: 'Right wheel',
  mainBrush: 'Main brush',
  sideBrush: 'Side brush',
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
  const motors = useMemo(() => Object.keys(MOTOR_LABELS), []);

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
          {motors.map((key) => {
            const meterA = overcurrentLimiter?.meters?.[key]?.a ?? 0;
            const meterB = overcurrentLimiter?.meters?.[key]?.b ?? 0;
            const over = overcurrentLimiter?.overcurrent?.[key] ?? false;
            const scale = overcurrentLimiter?.scales?.perMotor?.[key] ?? 1;
            return (
              <div key={key} className="surface space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-200">{MOTOR_LABELS[key] || key}</span>
                  <span className={over ? 'text-red-300' : 'text-slate-400'}>
                    {over ? 'overcurrent' : 'ok'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                    <span>Meter A</span>
                    <span>{formatPct(meterA)}</span>
                  </div>
                  <ProgressBar value={meterA} color="bg-amber-500" />
                  <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                    <span>Meter B</span>
                    <span>{formatPct(meterB)}</span>
                  </div>
                  <ProgressBar value={meterB} color="bg-red-500" />
                  <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                    <span>Scale</span>
                    <span>{formatPct(scale)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="surface text-[0.7rem] text-slate-400">
            <div>{`A charge ${overcurrentLimiter?.config?.meterAChargeSec}s · A decay ${overcurrentLimiter?.config?.meterADecaySec}s`}</div>
            <div>{`B charge ${overcurrentLimiter?.config?.meterBChargeSec}s · B decay ${overcurrentLimiter?.config?.meterBDecaySec}s`}</div>
          </div>
        </div>
      )}
    </section>
  );
}
