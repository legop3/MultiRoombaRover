import { WARN_DISPLAY_PERCENT } from '../lib/battery.js';

const WARN_FLASH_MS = 1600;
const URGENT_FLASH_MS = 800;

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function BatteryBar({
  visual,
  orientation = 'horizontal',
  variant = 'inline',
  compact = false,
  showLabel,
  className = '',
}) {
  const isBackground = variant === 'background';
  const isVertical = orientation === 'vertical';
  const resolvedShowLabel = showLabel ?? !isBackground;

  if (!visual?.available) {
    if (isBackground) {
      const warnPercent = WARN_DISPLAY_PERCENT;
      const markerClass = classNames(
        'absolute z-10',
        isVertical ? 'left-0 right-0 h-[2px]' : 'top-0 bottom-0 w-[2px]',
        'bg-black/70',
        isWarn && !isUrgent && 'battery-tick-warn',
      );
      const markerStyle = isVertical ? { bottom: `${warnPercent}%` } : { left: `${warnPercent}%` };
      const containerClass = classNames('absolute inset-0 pointer-events-none', className);
      return (
        <div className={containerClass}>
          <div className="absolute inset-0 bg-slate-900/35" />
          <div className={markerClass} style={markerStyle} />
        </div>
      );
    }
    if (isVertical) return null;
    return <p className="text-xs text-slate-500">Battery telemetry unavailable</p>;
  }

  const percentDisplay = visual.percentDisplay ?? 0;
  const percent = Math.max(0, Math.min(100, percentDisplay));
  const warnPercent = visual.warnDisplayPercent ?? WARN_DISPLAY_PERCENT;

  const isUrgent = Boolean(visual.urgentActive);
  const isWarn = Boolean(visual.warnActive);
  const shouldFlash = isUrgent || isWarn;
  const animationDuration = isUrgent ? `${URGENT_FLASH_MS}ms` : isWarn ? `${WARN_FLASH_MS}ms` : undefined;

  const fillColor = isUrgent || isWarn ? 'bg-red-500' : 'bg-emerald-500';
  const fillTone = isBackground
    ? isUrgent || isWarn
      ? 'bg-red-500/45'
      : 'bg-emerald-500/45'
    : fillColor;
  const baseTone = isUrgent || isWarn ? 'bg-red-900/35' : 'bg-slate-900/35';
  const baseToneStrong = isUrgent || isWarn ? 'bg-red-900/45' : 'bg-slate-900/35';

  const containerClass = classNames(
    isBackground ? 'absolute inset-0 pointer-events-none' : 'relative pointer-events-auto',
    isVertical && !isBackground ? 'flex flex-col items-center justify-center' : 'w-full',
    className,
  );

  if (isBackground) {
    const fillStyle = isVertical
      ? { height: `${percent}%` }
      : { width: `${percent}%` };
    const fillClass = classNames(
      'absolute',
      isVertical ? 'bottom-0 left-0 right-0' : 'left-0 top-0 bottom-0',
      fillTone,
      'transition-[width,height]',
      isUrgent && 'battery-urgent-flash',
    );
    const markerClass = classNames(
      'absolute z-10',
      isVertical ? 'left-0 right-0 h-[2px]' : 'top-0 bottom-0 w-[2px]',
      'bg-black/70',
      isWarn && !isUrgent && 'battery-tick-warn',
    );
    const markerStyle = isVertical ? { bottom: `${warnPercent}%` } : { left: `${warnPercent}%` };
    return (
      <div className={containerClass}>
        <div className={classNames('absolute inset-0', baseTone, isUrgent && 'battery-urgent-flash')} />
        <div className={fillClass} style={{ ...fillStyle, animationDuration }} />
        <div className={markerClass} style={markerStyle} />
      </div>
    );
  }

  const barShellClass = classNames(
    'relative overflow-hidden rounded-sm border border-slate-800',
    isUrgent || isWarn ? baseToneStrong : 'bg-zinc-900/90',
    isUrgent && 'battery-urgent-flash',
    isVertical
      ? 'w-full flex-1'
      : compact
        ? 'h-4'
        : 'h-5',
  );

  const fillStyle = isVertical
    ? { height: `${percent}%` }
    : { width: `${percent}%` };

  const fillClass = classNames(
    'absolute',
    isVertical ? 'bottom-0 left-0 right-0' : 'left-0 top-0 bottom-0',
    fillTone,
    'transition-[width,height]',
    isUrgent && 'battery-urgent-flash',
  );

  const markerClass = classNames(
    'absolute z-10',
    isVertical ? 'left-0 right-0 h-[2px]' : 'top-0 bottom-0 w-[2px]',
    'bg-black/70',
    isWarn && !isUrgent && 'battery-tick-warn',
  );
  const markerStyle = isVertical ? { bottom: `${warnPercent}%` } : { left: `${warnPercent}%` };

  const labelText = `Battery ${percentDisplay}%`;
  const labelClass = classNames(
    'pointer-events-none absolute inset-0 flex items-center justify-center text-center font-semibold',
    isVertical ? (compact ? 'text-[0.55rem]' : 'text-[0.65rem]') : 'text-xs',
  );
  const labelPillClass = classNames(
    'rounded px-1.5 py-0.5',
    isBackground ? 'bg-black/30 text-slate-100' : 'bg-black/50 text-slate-100',
  );

  return (
    <div className={containerClass}>
      <div className={barShellClass}>
        <div className={fillClass} style={{ ...fillStyle, animationDuration }} />
        <div className={markerClass} style={markerStyle} />
      </div>
      {resolvedShowLabel && !isVertical ? (
        <div className={labelClass}>
          <span className={labelPillClass}>{labelText}</span>
        </div>
      ) : null}
      {resolvedShowLabel && isVertical ? (
        <div className="mt-0.5 text-[0.65rem] font-semibold text-slate-100">
          <span className={labelPillClass}>{percentDisplay}%</span>
        </div>
      ) : null}
    </div>
  );
}
