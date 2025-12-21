import React from 'react';

function TopDownMap({ sensors = {}, variant = 'full', size: overrideSize }) {
  const size = overrideSize || (variant === 'mini' ? 190 : 260);
  const center = size / 2;
  const innerCircle = center * 0.8; // keep proportions consistent as size changes
  const lightRingInner = innerCircle - 4;
  const lightRingOuter = innerCircle + 4;
  const cliffRingInner = innerCircle - 14;
  const cliffRingOuter = innerCircle - 6;
  const wheelLineOffset = innerCircle * 0.65;

  const bumps = sensors?.bumpsAndWheelDrops || {};
  const wheelOver = sensors?.wheelOvercurrents || {};
  const wheelCurrentLeft = sensors?.wheelLeftCurrentMa ?? 0;
  const wheelCurrentRight = sensors?.wheelRightCurrentMa ?? 0;
  const sideBrushCurrent = sensors?.sideBrushCurrentMa ?? 0;
  const mainBrushCurrent = sensors?.mainBrushCurrentMa ?? 0;

  const lightAngles = buildSegments({
    count: 6,
    totalSpan: 140,
    gap: 6,
    startAngle: -70,
  });
  const lightLabels = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];
  const lightValues = [
    sensors?.lightBumpLeftSignal,
    sensors?.lightBumpFrontLeftSignal,
    sensors?.lightBumpCenterLeftSignal,
    sensors?.lightBumpCenterRightSignal,
    sensors?.lightBumpFrontRightSignal,
    sensors?.lightBumpRightSignal,
  ];
  const lightSegments = lightAngles.map((ang, idx) => ({
    label: lightLabels[idx],
    start: ang.start,
    end: ang.end,
    value: lightValues[idx],
  }));

  const cliffSegments = [
    { label: 'Cliff L', start: -60, end: -46, value: sensors?.cliffLeftSignal, active: sensors?.cliffLeft },
    { label: 'Cliff FL', start: -32, end: -16, value: sensors?.cliffFrontLeftSignal, active: sensors?.cliffFrontLeft },
    { label: 'Cliff FR', start: 16, end: 32, value: sensors?.cliffFrontRightSignal, active: sensors?.cliffFrontRight },
    { label: 'Cliff R', start: 46, end: 60, value: sensors?.cliffRightSignal, active: sensors?.cliffRight },
  ];

  const lightMaxSamples = lightValues.filter((v) => v != null);
  const maxLight = lightMaxSamples.length ? Math.max(...lightMaxSamples, 1200) : 1200;

  return (
    <div className="surface relative p-1" style={{ height: '100%', width: '100%', aspectRatio: '1 / 1' }}>
      <div className="absolute left-1 top-1 text-xs text-slate-400">Top-down</div>
      <div className="absolute right-1 top-1 text-[0.65rem] text-slate-500">0–{maxLight}</div>
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block">
        <circle cx={center} cy={center} r={innerCircle} fill="#0f172a" stroke="#334155" strokeWidth="2" />
        <WheelVisual
          cx={center - wheelLineOffset}
          cy={center}
          current={wheelCurrentLeft}
          drop={bumps.wheelDropLeft}
          overcurrent={wheelOver.leftWheel}
          label="L"
        />
        <WheelVisual
          cx={center + wheelLineOffset}
          cy={center}
          current={wheelCurrentRight}
          drop={bumps.wheelDropRight}
          overcurrent={wheelOver.rightWheel}
          label="R"
        />
        <SideBrushVisual
          cx={center + innerCircle * 0.65}
          cy={center - innerCircle * 0.55}
          current={sideBrushCurrent}
          overcurrent={wheelOver.sideBrush}
        />
        <MainBrushVisual
          cx={center}
          cy={center}
          current={mainBrushCurrent}
          overcurrent={wheelOver.mainBrush}
          variant={variant}
          dirtLeft={sensors?.dirtDetectLeft}
          dirtRight={sensors?.dirtDetect}
        />
        {lightSegments.map((seg) => {
          const color = lightBumpColor(seg.value);
          return (
            <ArcSegment
              key={seg.label}
              cx={center}
              cy={center}
              rInner={lightRingInner}
              rOuter={lightRingOuter}
              startDeg={seg.start}
              endDeg={seg.end}
              color={color}
              opacity={1}
              pulse={false}
            />
          );
        })}
        {cliffSegments.map((seg) => {
          const color = cliffColor(seg.value, seg.active);
          return (
            <ArcSegment
              key={seg.label}
              cx={center}
              cy={center}
              rInner={cliffRingInner}
              rOuter={cliffRingOuter}
              startDeg={seg.start}
              endDeg={seg.end}
              color={color}
              opacity={1}
              pulse={Boolean(seg.active)}
            />
          );
        })}
        <ArcSegment
          cx={center}
          cy={center}
          rInner={lightRingOuter + 2}
          rOuter={lightRingOuter + 8}
          startDeg={-70}
          endDeg={-6}
          color={bumps.bumpLeft ? '#ef4444' : '#475569'}
          opacity={1}
          pulse={Boolean(bumps.bumpLeft)}
        />
        <ArcSegment
          cx={center}
          cy={center}
          rInner={lightRingOuter + 2}
          rOuter={lightRingOuter + 8}
          startDeg={6}
          endDeg={70}
          color={bumps.bumpRight ? '#ef4444' : '#475569'}
          opacity={1}
          pulse={Boolean(bumps.bumpRight)}
        />
      </svg>
    </div>
  );
}

function ArcSegment({ cx, cy, rInner, rOuter, startDeg, endDeg, color, pulse = false, opacity = 1 }) {
  const rMid = (rInner + rOuter) / 2;
  const strokeWidth = rOuter - rInner;
  const path = describeArc(cx, cy, rMid, startDeg, endDeg);
  return (
    <>
      <path d={path} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" opacity={opacity} />
      {pulse ? (
        <path
          d={path}
          stroke="#ef4444"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          className="animate-pulse"
          opacity={1}
        />
      ) : null}
    </>
  );
}

function describeArc(cx, cy, r, startDeg, endDeg) {
  let start = startDeg;
  let end = endDeg;
  if (end <= start) end += 360;
  const startPt = polarToCartesian(cx, cy, r, start);
  const endPt = polarToCartesian(cx, cy, r, end);
  return ['M', startPt.x, startPt.y, 'A', r, r, 0, 0, 1, endPt.x, endPt.y].join(' ');
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = toRad(angleDeg);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function toRad(angleDeg) {
  return ((angleDeg - 90) * Math.PI) / 180;
}

function currentColor(value, overcurrent) {
  if (overcurrent) return '#ef4444';
  const mag = Math.abs(value);
  if (mag > 900) return '#f59e0b';
  if (mag > 300) return '#22c55e';
  return '#64748b';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function WheelVisual({ cx, cy, current, drop, overcurrent, label }) {
  const mag = Math.abs(current);
  const pct = clamp01(mag / 1200);
  const color = currentColor(current, overcurrent);
  const barH = 56;
  const currentW = 14;
  const dropW = 9;
  const gap = 3;
  const currentFill = barH * pct;
  const sign = label === 'L' ? -1 : 1;
  const currentCenterX = sign * (-dropW / 2 - gap / 2);
  const dropCenterX = sign * (currentW / 2 + gap / 2);
  const groupWidth = currentW + dropW + gap + 2;
  const groupHeight = barH + 4;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-groupWidth / 2} y={-groupHeight / 2} width={groupWidth} height={groupHeight} rx="4" fill="none" stroke="#64748b" strokeWidth="1" />
      <rect x={currentCenterX - currentW / 2} y={-barH / 2} width={currentW} height={barH} fill="#0f172a" stroke="#0f172a" strokeWidth="1" rx="2" />
      <rect x={currentCenterX - currentW / 2} y={barH / 2 - currentFill} width={currentW} height={currentFill} fill={color} className={overcurrent ? 'animate-pulse' : ''} />
      <rect x={dropCenterX - dropW / 2} y={-barH / 2} width={dropW} height={barH} fill={drop ? '#ef4444' : '#475569'} className={drop ? 'animate-pulse' : ''} rx="2" />
      <text x={0} y={barH / 2 + 10} textAnchor="middle" className="fill-slate-200 text-[0.7rem]">
        {label}
      </text>
    </g>
  );
}

function SideBrushVisual({ cx, cy, current, overcurrent }) {
  const mag = Math.abs(current);
  const color = currentColor(current * 3, overcurrent);
  const armLength = 42;
  const spinDuration = mag > 0 ? 0.65 : null;
  return (
    <g
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        animation: spinDuration ? `spin ${spinDuration}s linear infinite` : 'none',
      }}
    >
      <circle cx={cx} cy={cy} r={10} fill="#64748b" stroke="#64748b" strokeWidth="1" />
      {[0, 120, 240].map((deg) => {
        const rad = toRad(deg);
        const x2 = cx + armLength * Math.cos(rad);
        const y2 = cy + armLength * Math.sin(rad);
        return <line key={deg} x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth="4" strokeLinecap="round" />;
      })}
      {overcurrent ? <circle cx={cx} cy={cy} r={armLength + 8} stroke="#ef4444" strokeWidth="3" fill="none" className="animate-pulse" /> : null}
    </g>
  );
}

function MainBrushVisual({ cx, cy, current, overcurrent, variant, dirtLeft, dirtRight }) {
  const mag = Math.abs(current);
  const color = currentColor(current, overcurrent);
  const opacity = 1;
  const rollerWidth = 96;
  const rollerHeight = 12;
  const patternA = `main-brush-pattern-a-${variant}`;
  const patternB = `main-brush-pattern-b-${variant}`;
  const dur = mag > 0 ? 0.6 : null;
  const dir = current >= 0 ? 1 : -1;
  return (
    <g>
      <defs>
        {[patternA, patternB].map((id, idx) => (
          <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="6" height="6">
            <rect width="6" height="6" fill={color} opacity={opacity} />
            <path d="M0 6 L6 0" stroke="#0f172a" strokeWidth="1" />
            {dur ? (
              <animateTransform attributeName="patternTransform" type="translate" from="0 0" to={`0 ${dir * (idx === 0 ? 6 : -6)}`} dur={`${dur}s`} repeatCount="indefinite" />
            ) : null}
          </pattern>
        ))}
      </defs>
      <rect x={cx - rollerWidth / 2} y={cy - 14} width={rollerWidth} height={rollerHeight} rx="3" fill={`url(#${patternA})`} stroke="#64748b" strokeWidth="1" />
      <rect x={cx - rollerWidth / 2} y={cy + 4} width={rollerWidth} height={rollerHeight} rx="3" fill={`url(#${patternB})`} stroke="#64748b" strokeWidth="1" />
      <circle cx={cx - rollerWidth / 4} cy={cy - 8} r={3.5} fill="#fbbf24" />
      <circle cx={cx + rollerWidth / 4} cy={cy + 8} r={3.5} fill="#fbbf24" />
      {overcurrent ? (
        <rect
          x={cx - rollerWidth / 2 - 4}
          y={cy - 16}
          width={rollerWidth + 8}
          height={rollerHeight * 2 + 16}
          rx="6"
          stroke="#ef4444"
          strokeWidth="3"
          fill="none"
          className="animate-pulse"
        />
      ) : null}
    </g>
  );
}

const LIGHT_BUMP_SENSITIVITY = 0.18;
function lightBumpColor(value) {
  if (value == null || value <= 0) return '#000000';
  const hue = (value * LIGHT_BUMP_SENSITIVITY) % 360;
  return `hsl(${hue} 100% 60%)`;
}

function cliffColor(value, active) {
  if (active) return '#ef4444';
  const t = clamp01(value == null ? 0 : value / 4095);
  const start = [47, 55, 69];
  const end = [245, 158, 11];
  const [r, g, b] = start.map((s, i) => Math.round(s + (end[i] - s) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function buildSegments({ count, totalSpan, gap, startAngle }) {
  const usable = totalSpan - gap * (count - 1);
  const width = usable / count;
  const segments = [];
  let cursor = startAngle;
  for (let i = 0; i < count; i += 1) {
    const end = cursor + width;
    segments.push({ start: cursor, end });
    cursor = end + gap;
  }
  return segments;
}

export default TopDownMap;
