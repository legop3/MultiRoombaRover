// Overcurrent Protection Panel
// Purpose: Presents detailed server-calculated motor stress and command-tracking diagnostics.
// Scope: Read-only status surface for the assigned rover; protection and recovery remain server-owned.

import { useControlSelector } from '../../controls/index.js';
import CardFrame from '../CardFrame/index.jsx';

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

function formatSpeed(value) {
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value)} mm/s`;
}

function ProgressBar({ value, color = 'bg-emerald-500' }) {
  const width = `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
      <div className={`h-full ${color}`} style={{ width }} />
    </div>
  );
}

function statusLabel(protection) {
  if (protection?.adminImmune) return 'Admin bypass';
  if (protection?.status === 'stopped') return 'Drive stopped';
  if (protection?.status === 'limiting') return 'Limiting';
  if (protection?.status === 'overcurrent') return 'Overcurrent detected';
  if (protection?.status === 'recovering') return 'Recovering';
  return 'Ready';
}

export default function OvercurrentLimiterPanel() {
  const roverId = useControlSelector((control) => control.state.roverId);
  const protection = useControlSelector((control) => control.overcurrentLimiter);
  const motors = protection?.motors || {};

  return (
    <CardFrame
      title="Overcurrent protection"
      meta={statusLabel(protection)}
      bodyClassName="space-y-1 text-sm"
    >
      {!roverId ? (
        <p className="text-xs text-slate-500">Assign a rover to view protection status.</p>
      ) : (
        <div className="space-y-1">
          {Object.entries(MOTOR_LABELS).map(([key, label]) => {
            const motor = motors[key] || {};
            const wheel = key === 'leftWheel' || key === 'rightWheel';
            return (
              <div key={key} className="space-y-0.5 border-b border-slate-800 pb-1 last:border-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-200">{label}</span>
                  <span className={motor.overcurrent ? 'text-red-300' : 'text-slate-400'}>
                    {motor.overcurrent ? 'Overcurrent' : 'Clear'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[0.7rem] text-slate-400">
                  <span>Stress {formatPct(motor.stress)}</span>
                  <span>Output {formatPct(motor.cap)}</span>
                </div>
                <ProgressBar
                  value={motor.stress}
                  color={motor.overcurrent ? 'bg-red-500' : 'bg-amber-500'}
                />
                {wheel ? (
                  <div className="grid grid-cols-3 gap-1 text-[0.65rem] text-slate-500">
                    <span>{`Command ${formatSpeed(Math.abs(Number(motor.commandedSpeed)))}`}</span>
                    <span>{`Measured ${formatSpeed(motor.measuredSpeed)}`}</span>
                    <span>{`Stall ${formatPct(motor.stallFactor)}`}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
          {protection?.drive?.blocked ? (
            <p className="text-xs text-red-300">
              {protection.drive.requiresNeutral
                ? 'Drive is stopped. Release controls to neutral before resuming.'
                : 'Drive is stopped while the wheel condition clears.'}
            </p>
          ) : null}
          <div className="text-[0.7rem] text-slate-400">
            <div>{`Drive output ${formatPct(protection?.drive?.cap)}`}</div>
            <div>
              {protection?.adminImmune
                ? 'This session bypasses all overcurrent enforcement.'
                : 'Status and output limits are calculated by the server.'}
            </div>
          </div>
        </div>
      )}
    </CardFrame>
  );
}
