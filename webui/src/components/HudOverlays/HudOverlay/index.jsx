// Hud Overlay
// Purpose: Defines the Hud Overlay module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { useHudMapSetting } from '../../../hooks/useHudMapSetting.js';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useTelemetryFrame } from '../../../context/TelemetryContext.jsx';
import TopDownMap from '../../TopDownMap/index.jsx';
import { roverNameChromeStyle } from '../../../lib/roverColor.js';

function HudOverlay({
  roverId = null,
  sensors,
  label,
  roverColor = null,
  layoutFormat = 'desktop',
  variant = 'default',
  driverLabel = null,
  showTopDown = undefined,
  mobileHud = false,
  mapPosition = null,
  labelScale = 1,
}) {
  const assignedRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const effectiveRoverId = roverId ?? assignedRoverId;
  const frame = useTelemetryFrame(effectiveRoverId);
  const rosterInfo = useSessionSelector((state) => {
    if (!effectiveRoverId) return { label: null, roverColor: null };
    const roster = state.session?.roster || [];
    const rover = roster.find((entry) => String(entry.id) === String(effectiveRoverId));
    return {
      label: rover?.name || null,
      roverColor: rover?.color || null,
    };
  });
  const derivedDriverLabel = useSessionSelector((state) => {
    if (!effectiveRoverId || variant !== 'spectator') return null;
    const activeId = state.session?.activeDrivers?.[effectiveRoverId] || null;
    const users = state.session?.users || [];
    const match = users.find((u) => String(u.socketId || '') === String(activeId || ''));
    return match?.nickname || match?.name || null;
  });
  const resolvedSensors = sensors ?? frame?.sensors ?? null;
  const resolvedLabel = label ?? rosterInfo.label ?? null;
  const resolvedRoverColor = roverColor ?? rosterInfo.roverColor ?? null;
  const resolvedDriverLabel = driverLabel ?? derivedDriverLabel;
  const isMobile = mobileHud;
  const [showHudMapDesktop] = useHudMapSetting();
  const resolvedShowTopDown =
    typeof showTopDown === 'boolean'
      ? showTopDown
      : variant === 'spectator'
      ? true
      : isMobile
      ? true
      : showHudMapDesktop;
  const resolvedMapPosition =
    mapPosition || (variant === 'spectator' ? 'top-center' : isMobile ? 'top-right' : 'top-center');
  const portraitMobile = layoutFormat === 'mobile-portrait';
  const statusPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-1 py-0.5';
  const labelPadClass = isMobile ? 'px-0.25 py-0.25' : 'px-0.5 py-0.5';
  const labelTextClass = isMobile ? 'text-[0.55rem]' : 'text-[0.8rem]';
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
    transform: resolvedMapPosition === 'top-center' ? `translateX(-50%) scale(${mapScale})` : `scale(${mapScale})`,
    transformOrigin:
      resolvedMapPosition === 'bottom-left'
        ? 'bottom left'
        : resolvedMapPosition === 'top-center'
        ? 'top center'
        : 'top right',
    ...(resolvedMapPosition === 'bottom-left'
      ? { left: '0.25rem', bottom: '0.25rem' }
      : resolvedMapPosition === 'top-center'
        ? { left: '50%', top: '0.25rem' }
        : { right: '0.25rem', top: '0.25rem' }),
  };

  if (variant === 'none') {
    return null;
  }

  if (variant === 'spectator') {
    const telemetryEntries = [
      ['Voltage', resolvedSensors?.voltageMv != null ? `${(resolvedSensors.voltageMv / 1000).toFixed(2)} V` : '--'],
      ['Current', resolvedSensors?.currentMa != null ? `${resolvedSensors.currentMa} mA` : '--'],
      ['Charge', resolvedSensors?.batteryChargeMah != null ? `${resolvedSensors.batteryChargeMah}` : '--'],
      ['OI', resolvedSensors?.oiMode?.label || '--'],
    ];
    const docked = Boolean(resolvedSensors?.chargingSources?.homeBase);
    const chargingLabel = resolvedSensors?.chargingState?.label || '';
    const charging = Boolean(chargingLabel && chargingLabel.toLowerCase() !== 'not charging');
    const oiLabel = resolvedSensors?.oiMode?.label || 'Unknown';
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
          <div
            className={`absolute ${telemetryPosClass} flex -translate-y-1/2 flex-col gap-0.5 bg-black/70 text-slate-100 ${isMobile ? 'text-[0.45rem]' : 'text-[0.65rem]'} ${statusPadClass}`}
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
                style={roverNameChromeStyle(resolvedRoverColor, 0.18)}
              >
                {resolvedLabel || 'Unnamed Rover'}
              </span>
              {resolvedDriverLabel ? <span className="text-slate-300">• {resolvedDriverLabel}</span> : null}
            </div>
          </div>
        </div>
        {resolvedShowTopDown ? (
          <div className="pointer-events-none absolute rounded" style={{ ...mapStyle }}>
            <TopDownMap sensors={resolvedSensors} size={240} overlay />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
        <div className={`flex gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}>
          <span>
            Rover:{' '}
            <span
              className="rounded px-1 py-[1px] border border-transparent"
              style={roverNameChromeStyle(resolvedRoverColor, 0.18)}
            >
              "{resolvedLabel || 'Unnamed Rover'}"
            </span>
          </span>
        </div>
      </div>

      {resolvedShowTopDown && variant !== 'spectator' ? (
        <div className="pointer-events-none absolute rounded" style={{ ...mapStyle }}>
          <TopDownMap sensors={resolvedSensors} size={240} overlay />
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(HudOverlay);
