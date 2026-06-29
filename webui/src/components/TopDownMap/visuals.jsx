// visuals
// Purpose: Defines the visuals module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React, { useMemo } from 'react';
import { clamp01, currentColor, describeArc, polarToCartesian, toRad } from './helpers.js';

export const ArcSegment = React.memo(function ArcSegment({ cx, cy, rInner, rOuter, startDeg, endDeg, color, pulse = false, opacity = 1 }) {
  const rMid = (rInner + rOuter) / 2;
  const strokeWidth = rOuter - rInner;
  const path = useMemo(
    () => describeArc(cx, cy, rMid, startDeg, endDeg),
    [cx, cy, endDeg, rMid, startDeg],
  );
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
});

export const CurvedArcBar = React.memo(function CurvedArcBar({
  cx,
  cy,
  rInner,
  rOuter,
  startDeg,
  endDeg,
  percent,
  backgroundColor,
  fillColor,
  fillFromEnd = false,
}) {
  const safePercent = clamp01(percent ?? 0);
  const rMid = (rInner + rOuter) / 2;
  const strokeWidth = rOuter - rInner;
  const backgroundPath = useMemo(
    () => describeArc(cx, cy, rMid, startDeg, endDeg),
    [cx, cy, endDeg, rMid, startDeg],
  );
  const fillPath = useMemo(() => {
    // The foreground bar uses the same arc geometry as the background pill.
    // Mirroring is done by anchoring the fill to the opposite end of the arc,
    // which keeps left/right cliff sensors visually symmetric around the robot.
    const span = endDeg - startDeg;
    const fillSpan = span * safePercent;
    const fillStart = fillFromEnd ? endDeg - fillSpan : startDeg;
    const fillEnd = fillFromEnd ? endDeg : startDeg + fillSpan;
    return describeArc(cx, cy, rMid, fillStart, fillEnd);
  }, [cx, cy, endDeg, fillFromEnd, rMid, safePercent, startDeg]);

  return (
    <>
      <path d={backgroundPath} stroke={backgroundColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" opacity="0.95" />
      {safePercent > 0 ? (
        <path d={fillPath} stroke={fillColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" opacity="1" />
      ) : null}
    </>
  );
});

export const ConeSegment = React.memo(function ConeSegment({ cx, cy, rBase, rTip, startDeg, endDeg, color, value, max }) {
  const mid = (startDeg + endDeg) / 2;
  const norm = clamp01(value != null ? value / (max || 1) : 0);
  const eased = Math.pow(norm, 0.35);
  const filledR = rBase - (rBase - rTip) * eased;
  const barR = Math.max(rTip, Math.min(filledR, rBase));
  const fg = useMemo(() => {
    // The cone geometry is still dynamic because the filled radius changes
    // with light-bump strength, but the memo prevents unrelated parent renders
    // from rebuilding the SVG path string for every cone.
    const tip = polarToCartesian(cx, cy, rTip, mid);
    const filledA = polarToCartesian(cx, cy, barR, startDeg);
    const filledB = polarToCartesian(cx, cy, barR, endDeg);
    return `M ${tip.x} ${tip.y} L ${filledA.x} ${filledA.y} L ${filledB.x} ${filledB.y} Z`;
  }, [barR, cx, cy, endDeg, mid, rTip, startDeg]);

  return <path d={fg} fill={color} opacity={1} stroke="none" />;
});

export const WheelVisual = React.memo(function WheelVisual({ cx, cy, current, drop, overcurrent, label }) {
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
  const dropLabelRotation = label === 'L' ? -90 : 90;
  const groupWidth = currentW + dropW + gap + 2;
  const groupHeight = barH + 4;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-groupWidth / 2} y={-groupHeight / 2} width={groupWidth} height={groupHeight} rx="4" fill="none" stroke="#64748b" strokeWidth="1" />
      <rect x={currentCenterX - currentW / 2} y={-barH / 2} width={currentW} height={barH} fill="#0f172a" stroke="#0f172a" strokeWidth="1" rx="2" />
      <rect x={currentCenterX - currentW / 2} y={barH / 2 - currentFill} width={currentW} height={currentFill} fill={color} className={overcurrent ? 'animate-pulse' : ''} />
      <rect x={dropCenterX - dropW / 2} y={-barH / 2} width={dropW} height={barH} fill={drop ? '#ef4444' : '#475569'} className={drop ? 'animate-pulse' : ''} rx="2" />
      {drop ? (
        <text
          x={dropCenterX}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${dropLabelRotation} ${dropCenterX} 0)`}
          className="pointer-events-none fill-white text-[0.48rem] font-bold"
        >
          Dropped
        </text>
      ) : null}
      <text x={0} y={barH / 2 + 10} textAnchor="middle" className="fill-slate-200 text-[0.7rem]">{label}</text>
    </g>
  );
});

export const SideBrushVisual = React.memo(function SideBrushVisual({ cx, cy, current, overcurrent }) {
  let mag = Math.abs(current);
  if (mag < 10) mag = 0;
  const color = currentColor(current * 3, overcurrent);
  const armLength = 43;
  const spinDuration = mag > 0 ? 0.65 : null;
  const spinDirection = 'reverse';

  return (
    <g
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        animation: spinDuration ? `spin ${spinDuration}s linear infinite` : 'none',
        animationDirection: spinDuration ? spinDirection : 'normal',
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
});

export const ReadoutBar = React.memo(function ReadoutBar({
  x,
  y,
  width,
  height,
  label,
  valueText,
  percent,
  color = '#38bdf8',
  missing = false,
}) {
  const safePercent = clamp01(percent ?? 0);
  const fillWidth = width * safePercent;

  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={width} height={height} rx="4" fill="#020617" opacity="0.9" stroke="#334155" strokeWidth="1" />
      <rect x="2" y={height - 5} width={width - 4} height="3" rx="1.5" fill="#1e293b" />
      <rect x="2" y={height - 5} width={Math.max(0, fillWidth - 4)} height="3" rx="1.5" fill={missing ? '#475569' : color} />
      <text x="5" y="9" className="fill-slate-400 text-[0.48rem] font-semibold">{label}</text>
      <text x={width - 5} y="10" textAnchor="end" className="fill-slate-100 text-[0.55rem] font-semibold">{valueText}</text>
    </g>
  );
});

export const RawFrameStrip = React.memo(function RawFrameStrip({ x, y, width, height, bytes }) {
  const safeBytes = Array.isArray(bytes) ? bytes : [];
  const count = safeBytes.length;
  const gap = 0;
  const cellWidth = count > 0 ? Math.max(0.8, (width - gap * (count - 1)) / count) : width;

  return (
    <g transform={`translate(${x},${y})`} opacity="0.72">
      {safeBytes.map((byte, idx) => {
        // This strip intentionally visualizes the raw decoded frame bytes
        // instead of decoded sensor meanings. Hue makes byte identity visible,
        // while bar height makes quiet/low and loud/high byte values distinct.
        const value = Number.isFinite(byte) ? Math.max(0, Math.min(255, byte)) : 0;
        const normalized = value / 255;
        const barHeight = 2 + normalized * (height - 5);
        const hue = Math.round(normalized * 300 + 35);
        const barX = idx * (cellWidth + gap);
        const barY = height - 2 - barHeight;

        return (
          <rect
            key={idx}
            x={barX + 1}
            y={barY}
            width={Math.max(0.6, cellWidth)}
            height={barHeight}
            rx="0.8"
            fill={`hsl(${hue} 95% 58%)`}
          />
        );
      })}
    </g>
  );
});

export const MainBrushVisual = React.memo(function MainBrushVisual({ cx, cy, current, overcurrent, variant, dirtLeft, dirtRight }) {
  const mag = Math.abs(current);
  const color = currentColor(current, overcurrent);
  const opacity = 1;
  const rollerWidth = 96;
  const rollerHeight = 12;
  const patternA = `main-brush-pattern-a-${variant}`;
  const patternB = `main-brush-pattern-b-${variant}`;
  const dur = mag > 0 ? 0.6 : null;
  const dir = current >= 0 ? 1 : -1;

  const renderDirtDot = (dotCx, dotCy, value) => {
    // The Create dirt packets are impulse-style 0-255 counters rather than a
    // calibrated percentage. A low divisor keeps small real hits visible, while
    // clamp01 prevents rare large values from growing beyond the brush layout.
    const numericValue = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const strength = clamp01(numericValue / 80);
    const radius = 2.5 + strength * 5.5;
    const fill = numericValue > 0 ? '#fbbf24' : '#475569';
    const stroke = numericValue > 0 ? '#fde68a' : '#1e293b';
    return (
      <circle
        cx={dotCx}
        cy={dotCy}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
        opacity={numericValue > 0 ? 0.95 : 0.45}
        className={numericValue > 0 ? 'animate-pulse' : ''}
      />
    );
  };

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
      {renderDirtDot(cx - rollerWidth / 4, cy - 8, dirtLeft)}
      {renderDirtDot(cx + rollerWidth / 4, cy + 8, dirtRight)}
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
});
