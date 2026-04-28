// SVG primitives for top-down rover map rendering.
import React from 'react';
import { clamp01, currentColor, describeArc, lightBumpColor, cliffColor, polarToCartesian, toRad } from './helpers.js';

export function ArcSegment({ cx, cy, rInner, rOuter, startDeg, endDeg, color, pulse = false, opacity = 1 }) {
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

export function ConeSegment({ cx, cy, rBase, rTip, startDeg, endDeg, color, value, max }) {
  const mid = (startDeg + endDeg) / 2;
  const tip = polarToCartesian(cx, cy, rTip, mid);
  const norm = clamp01(value != null ? value / (max || 1) : 0);
  const eased = Math.pow(norm, 0.35);
  const filledR = rBase - (rBase - rTip) * eased;
  const barR = Math.max(rTip, Math.min(filledR, rBase));
  const filledA = polarToCartesian(cx, cy, barR, startDeg);
  const filledB = polarToCartesian(cx, cy, barR, endDeg);
  const fg = `M ${tip.x} ${tip.y} L ${filledA.x} ${filledA.y} L ${filledB.x} ${filledB.y} Z`;

  return <path d={fg} fill={color} opacity={1} stroke="none" />;
}

export function WheelVisual({ cx, cy, current, drop, overcurrent, label }) {
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
      <text x={0} y={barH / 2 + 10} textAnchor="middle" className="fill-slate-200 text-[0.7rem]">{label}</text>
    </g>
  );
}

export function SideBrushVisual({ cx, cy, current, overcurrent }) {
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
}

export function MainBrushVisual({ cx, cy, current, overcurrent, variant, dirtLeft, dirtRight }) {
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

export { lightBumpColor, cliffColor };
