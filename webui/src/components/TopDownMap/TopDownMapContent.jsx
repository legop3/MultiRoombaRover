// Top Down Map Content
// Purpose: Defines the Top Down Map Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React from 'react';
import { buildSegments } from './helpers.js';
import {
  ArcSegment,
  ConeSegment,
  WheelVisual,
  SideBrushVisual,
  MainBrushVisual,
  lightBumpColor,
  cliffColor,
} from './visuals.jsx';

function TopDownMapContent({ sensors = {}, variant = 'full', size: overrideSize, overlay = false }) {
  const size = overrideSize || (variant === 'mini' ? 190 : 260);
  const center = size / 2;
  const offsetY = size * 0.07;
  const centerX = center;
  const centerY = center + offsetY;
  const innerCircle = center * 0.8;
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
  const bumpDepress = 6;
  const bumpLeftOffset = bumps.bumpLeft ? bumpDepress : 0;
  const bumpRightOffset = bumps.bumpRight ? bumpDepress : 0;

  const lightAngles = buildSegments({ count: 6, totalSpan: 140, gap: 6, startAngle: -70 });
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
    <div
      className={`${overlay ? 'relative' : 'relative p-1'}`}
      style={overlay ? { width: `${size}px`, height: `${size}px` } : { height: '100%', width: '100%', aspectRatio: '1 / 1' }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block">
        <circle cx={centerX} cy={centerY} r={innerCircle} fill="#0f172a" stroke="#334155" strokeWidth="2" />
        <WheelVisual cx={centerX - wheelLineOffset} cy={centerY} current={wheelCurrentLeft} drop={bumps.wheelDropLeft} overcurrent={wheelOver.leftWheel} label="L" />
        <WheelVisual cx={centerX + wheelLineOffset} cy={centerY} current={wheelCurrentRight} drop={bumps.wheelDropRight} overcurrent={wheelOver.rightWheel} label="R" />
        <SideBrushVisual cx={centerX + innerCircle * 0.65} cy={centerY - innerCircle * 0.55} current={sideBrushCurrent} overcurrent={wheelOver.sideBrush} />
        <MainBrushVisual
          cx={centerX}
          cy={centerY}
          current={mainBrushCurrent}
          overcurrent={wheelOver.mainBrush}
          variant={variant}
          dirtLeft={sensors?.dirtDetectLeft}
          dirtRight={sensors?.dirtDetect}
        />
        {lightSegments.map((seg) => {
          const color = lightBumpColor(seg.value, maxLight);
          const tipR = lightRingOuter + 4;
          const baseR = tipR + 28;
          return (
            <ConeSegment
              key={seg.label}
              cx={centerX}
              cy={centerY}
              rBase={baseR}
              rTip={tipR}
              startDeg={seg.start}
              endDeg={seg.end}
              color={color}
              value={seg.value}
              max={maxLight}
            />
          );
        })}
        {cliffSegments.map((seg) => (
          <ArcSegment
            key={seg.label}
            cx={centerX}
            cy={centerY}
            rInner={cliffRingInner}
            rOuter={cliffRingOuter}
            startDeg={seg.start}
            endDeg={seg.end}
            color={cliffColor(seg.value, seg.active)}
            opacity={1}
            pulse={Boolean(seg.active)}
          />
        ))}
        <ArcSegment
          cx={centerX}
          cy={centerY}
          rInner={lightRingInner - bumpLeftOffset}
          rOuter={lightRingOuter - bumpLeftOffset}
          startDeg={-70}
          endDeg={-6}
          color={bumps.bumpLeft ? '#ef4444' : '#475569'}
          opacity={1}
          pulse={Boolean(bumps.bumpLeft)}
        />
        <ArcSegment
          cx={centerX}
          cy={centerY}
          rInner={lightRingInner - bumpRightOffset}
          rOuter={lightRingOuter - bumpRightOffset}
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

export default React.memo(TopDownMapContent);
