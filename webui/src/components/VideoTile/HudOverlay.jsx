// Telemetry HUD and map overlay for VideoTile.
import React from 'react';
import TopDownMap from '../TopDownMap.jsx';
import { roverNameChromeStyle } from '../../lib/roverColor.js';

export default function HudOverlay({
  sensors,
  label,
  roverColor = null,
  status,
  audioStatus,
  levelStatus,
  layoutFormat = 'desktop',
  variant = 'default',
  driverLabel = null,
  showTopDown = false,
  mobileHud = false,
  mapPosition = 'top-center',
  turnTimerText = null,
  labelScale = 1,
}) {
  const isMobile = mobileHud;
  const portraitMobile = layoutFormat === 'mobile-portrait';
  const statusTextClass = isMobile ? 'text-[0.45rem]' : 'text-[0.65rem]';
  const statusPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-1 py-0.5';
  const labelPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-0.5 py-0.5';
  const labelTextClass = isMobile ? 'text-[0.55rem]' : 'text-[0.8rem]';
  const statusPosClass = isMobile ? 'left-0.5 top-0.5' : 'left-1 top-1';
  const timerTextClass = isMobile ? 'text-[0.5rem]' : 'text-[0.7rem]';
  const timerPadClass = isMobile ? 'px-0.5 py-0.25' : 'px-1 py-0.5';
  const telemetryPosClass = isMobile ? 'left-0.5 top-1/2' : 'left-1 top-1/2';
  const labelPosClass = isMobile ? 'bottom-0.5' : 'bottom-0.5';
  const labelWrapperStyle = {
    transform: `translateX(-50%) scale(${labelScale})`,
    transformOrigin: 'center bottom',
  };
  const mapSize = '240px';
  const mapScale = portraitMobile ? 0.3 : isMobile ? 0.33 : 0.7;
  const mapOpacity = isMobile ? 0.6 : 0.7;
  const mapStyle = {
    width: mapSize,
    height: mapSize,
    opacity: mapOpacity,
    transform: mapPosition === 'top-center' ? `translateX(-50%) scale(${mapScale})` : `scale(${mapScale})`,
    transformOrigin:
      mapPosition === 'bottom-left' ? 'bottom left' : mapPosition === 'top-center' ? 'top center' : 'top right',
    ...(mapPosition === 'bottom-left'
      ? { left: '0.25rem', bottom: '0.25rem' }
      : mapPosition === 'top-center'
        ? { left: '50%', top: '0.25rem' }
        : { right: '0.25rem', top: '0.25rem' }),
  };

  if (variant === 'none') {
    return null;
  }

  if (variant === 'spectator') {
    const telemetryEntries = [
      ['Voltage', sensors?.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : '--'],
      ['Current', sensors?.currentMa != null ? `${sensors.currentMa} mA` : '--'],
      ['Charge', sensors?.batteryChargeMah != null ? `${sensors.batteryChargeMah}` : '--'],
      ['OI', sensors?.oiMode?.label || '--'],
    ];
    const docked = Boolean(sensors?.chargingSources?.homeBase);
    const chargingLabel = sensors?.chargingState?.label || '';
    const charging = Boolean(chargingLabel && chargingLabel.toLowerCase() !== 'not charging');
    const oiLabel = sensors?.oiMode?.label || 'Unknown';
    const oiNormalized = oiLabel.toLowerCase();
    const oiTone =
      oiNormalized === 'full'
        ? 'bg-emerald-500/80 text-emerald-50'
        : oiNormalized === 'safe'
          ? 'bg-amber-400/80 text-amber-950'
          : oiNormalized === 'passive'
            ? 'bg-slate-700/80 text-slate-100'
            : 'bg-slate-700/60 text-slate-200';
    const dockTone = docked ? 'bg-emerald-500/80 text-emerald-50' : 'bg-slate-700/70 text-slate-200';
    const chargingTone = charging
      ? 'bg-emerald-500/80 text-emerald-50'
      : docked
        ? 'bg-amber-400/80 text-amber-950'
        : 'bg-slate-700/70 text-slate-200';
    return (
      <>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={`absolute ${statusPosClass} font-medium text-slate-100 ${statusTextClass}`}>
            <div className="flex flex-col gap-0.5 leading-none">
              <span>Status: {status}</span>
              {audioStatus ? <span>Audio: {audioStatus}</span> : null}
              {levelStatus ? <span className="text-cyan-300">{levelStatus}</span> : null}
            </div>
          </div>
          <div
            className={`absolute ${telemetryPosClass} flex -translate-y-1/2 flex-col gap-0.5 bg-black/70 text-slate-100 ${statusTextClass} ${statusPadClass}`}
          >
            <div className="space-y-0.5 leading-tight">
              <div className="flex flex-col gap-0.5 text-[0.75rem] font-semibold uppercase tracking-wide">
                <span className={`rounded px-1.5 py-0.5 ${dockTone}`}>{docked ? 'Docked' : 'Undocked'}</span>
                <span className={`rounded px-1.5 py-0.5 ${chargingTone}`}>
                  {charging ? 'Charging' : docked ? 'Not charging' : 'Not charging'}
                </span>
                <span className={`rounded px-1.5 py-0.5 ${oiTone}`}>OI: {oiLabel}</span>
              </div>
              {telemetryEntries.map(([labelText, value]) => (
                <span key={labelText} className="flex items-center justify-between gap-0.5">
                  <span className="text-slate-400">{labelText}</span>
                  <span className="font-semibold text-white">{value}</span>
                </span>
              ))}
            </div>
          </div>

          <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
            <div
              className={`flex items-center gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}
            >
              <span
                className="font-semibold text-white rounded px-1 py-[1px] border border-transparent"
                style={roverNameChromeStyle(roverColor, 0.18)}
              >
                {label || 'Unnamed Rover'}
              </span>
              {driverLabel ? <span className="text-slate-300">• {driverLabel}</span> : null}
            </div>
          </div>
        </div>
        {showTopDown ? (
          <div className="pointer-events-none absolute rounded" style={{ ...mapStyle }}>
            <TopDownMap sensors={sensors} size={240} overlay />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className={`absolute ${statusPosClass} font-medium text-slate-100 ${statusTextClass}`}>
        <div className="flex flex-col gap-0.5 leading-none">
          <span>Status: {status}</span>
          {audioStatus ? <span>Audio: {audioStatus}</span> : null}
          {levelStatus ? <span className="text-cyan-300">{levelStatus}</span> : null}
        </div>
      </div>
      {turnTimerText ? (
        <div
          className={`absolute left-1/2 top-0.5 -translate-x-1/2 rounded bg-black/70 text-slate-100 ${timerPadClass} ${timerTextClass}`}
        >
          {turnTimerText}
        </div>
      ) : null}
      <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
        <div className={`flex gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}>
          <span>
            Rover:{' '}
            <span
              className="rounded px-1 py-[1px] border border-transparent"
              style={roverNameChromeStyle(roverColor, 0.18)}
            >
              "{label || 'Unnamed Rover'}"
            </span>
          </span>
        </div>
      </div>

      {showTopDown && variant !== 'spectator' ? (
        <div className="pointer-events-none absolute rounded" style={{ ...mapStyle }}>
          <TopDownMap sensors={sensors} size={240} overlay />
        </div>
      ) : null}
    </div>
  );
}
