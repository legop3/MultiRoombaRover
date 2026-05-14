import { roverNameChromeStyle } from '../../../lib/roverColor.js';

export default function RoverLabelOverlay({
  variant = 'default',
  label,
  roverColor = null,
  driverLabel = null,
  mobileHud = false,
  labelScale = 1,
}) {
  const labelPadClass = mobileHud ? 'px-0.25 py-0.25' : 'px-0.5 py-0.5';
  const labelTextClass = mobileHud ? 'text-[0.55rem]' : 'text-[0.8rem]';
  const labelPosClass = 'bottom-0.5';
  const labelWrapperStyle = {
    transform: `translateX(-50%) scale(${labelScale})`,
    transformOrigin: 'center bottom',
  };

  if (variant === 'spectator') {
    return (
      <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
        <div className={`flex items-center gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}>
          <span
            className="font-semibold text-white rounded px-1 py-[1px] border border-transparent"
            style={roverNameChromeStyle(roverColor, 0.18)}
          >
            {label || 'No rover'}
          </span>
          {driverLabel ? <span className="text-slate-300">• {driverLabel}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`absolute ${labelPosClass} left-1/2`} style={labelWrapperStyle}>
      <div className={`flex gap-0.5 bg-black/80 text-slate-100 ${labelPadClass} ${labelTextClass}`}>
        <span>
          Rover:{' '}
          <span
            className="rounded px-1 py-[1px] border border-transparent"
            style={roverNameChromeStyle(roverColor, 0.18)}
          >
            "{label || 'No rover'}"
          </span>
        </span>
      </div>
    </div>
  );
}
