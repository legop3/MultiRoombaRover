// Top Down Map Content
// Purpose: Defines the Top Down Map Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React, { useMemo } from 'react';
import { selectVisualMapTelemetry } from '../../context/telemetryViews.js';
import { buildSegments, cliffColor, lightBumpColor } from './helpers.js';
import {
  ArcSegment,
  ConeSegment,
  WheelVisual,
  SideBrushVisual,
  MainBrushVisual,
} from './visuals.jsx';

const LIGHT_LABELS = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];

function buildGeometry(size, variant) {
  const center = size / 2;
  const offsetY = size * 0.05;
  const centerX = center;
  const centerY = center + offsetY;
  const innerCircle = center * 0.8;
  const lightRingInner = innerCircle - 4;
  const lightRingOuter = innerCircle + 4;
  const cliffRingInner = innerCircle - 14;
  const cliffRingOuter = innerCircle - 6;
  const wheelLineOffset = innerCircle * 0.65;
  const lightAngles = buildSegments({ count: 6, totalSpan: 140, gap: 6, startAngle: -70 });

  return {
    size,
    variant,
    centerX,
    centerY,
    innerCircle,
    lightRingInner,
    lightRingOuter,
    cliffRingInner,
    cliffRingOuter,
    wheelLineOffset,
    lightSegments: lightAngles.map((angle, idx) => ({
      label: LIGHT_LABELS[idx],
      start: angle.start,
      end: angle.end,
    })),
    cliffSegments: [
      { label: 'Cliff L', start: -60, end: -46, valueKey: 'cliffLeftSignal', activeKey: 'cliffLeft' },
      { label: 'Cliff FL', start: -32, end: -16, valueKey: 'cliffFrontLeftSignal', activeKey: 'cliffFrontLeft' },
      { label: 'Cliff FR', start: 16, end: 32, valueKey: 'cliffFrontRightSignal', activeKey: 'cliffFrontRight' },
      { label: 'Cliff R', start: 46, end: 60, valueKey: 'cliffRightSignal', activeKey: 'cliffRight' },
    ],
  };
}

function TopDownMapContent({ sensors = {}, mapTelemetry = null, variant = 'full', size: overrideSize, overlay = false }) {
  const size = overrideSize || (variant === 'mini' ? 190 : 260);
  const geometry = useMemo(() => buildGeometry(size, variant), [size, variant]);

  // The map accepts either the new selector-produced telemetry shape or the old
  // raw sensors prop. Keeping this translation local lets existing non-hot paths
  // continue to render while high-frequency callers move to targeted selectors.
  const telemetry = mapTelemetry ?? selectVisualMapTelemetry({ sensors });
  const wheelCurrentLeft = telemetry.wheelLeftCurrentMa ?? 0;
  const wheelCurrentRight = telemetry.wheelRightCurrentMa ?? 0;
  const sideBrushCurrent = telemetry.sideBrushCurrentMa ?? 0;
  const mainBrushCurrent = telemetry.mainBrushCurrentMa ?? 0;
  const bumpDepress = 6;
  const bumpLeftOffset = telemetry.bumpLeft ? bumpDepress : 0;
  const bumpRightOffset = telemetry.bumpRight ? bumpDepress : 0;

  const lightValues = [
    telemetry.lightBumpLeftSignal,
    telemetry.lightBumpFrontLeftSignal,
    telemetry.lightBumpCenterLeftSignal,
    telemetry.lightBumpCenterRightSignal,
    telemetry.lightBumpFrontRightSignal,
    telemetry.lightBumpRightSignal,
  ];

  const lightMaxSamples = lightValues.filter((v) => v != null);
  const maxLight = lightMaxSamples.length ? Math.max(...lightMaxSamples, 1200) : 1200;

  return (
    <div
      className={`${overlay ? 'relative' : 'relative p-1'}`}
      style={overlay ? { width: `${size}px`, height: `${size}px` } : { height: '100%', width: '100%', aspectRatio: '1 / 1' }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block">
        <circle cx={geometry.centerX} cy={geometry.centerY} r={geometry.innerCircle} fill="#0f172a" stroke="#334155" strokeWidth="2" />
        <WheelVisual cx={geometry.centerX - geometry.wheelLineOffset} cy={geometry.centerY} current={wheelCurrentLeft} drop={telemetry.wheelDropLeft} overcurrent={telemetry.leftWheelOvercurrent} label="L" />
        <WheelVisual cx={geometry.centerX + geometry.wheelLineOffset} cy={geometry.centerY} current={wheelCurrentRight} drop={telemetry.wheelDropRight} overcurrent={telemetry.rightWheelOvercurrent} label="R" />
        <SideBrushVisual cx={geometry.centerX + geometry.innerCircle * 0.65} cy={geometry.centerY - geometry.innerCircle * 0.55} current={sideBrushCurrent} overcurrent={telemetry.sideBrushOvercurrent} />
        <MainBrushVisual
          cx={geometry.centerX}
          cy={geometry.centerY}
          current={mainBrushCurrent}
          overcurrent={telemetry.mainBrushOvercurrent}
          variant={variant}
        />
        {geometry.lightSegments.map((seg, idx) => {
          const value = lightValues[idx];
          const color = lightBumpColor(value, maxLight);
          const tipR = geometry.lightRingOuter + 4;
          const baseR = tipR + 28;
          return (
            <ConeSegment
              key={seg.label}
              cx={geometry.centerX}
              cy={geometry.centerY}
              rBase={baseR}
              rTip={tipR}
              startDeg={seg.start}
              endDeg={seg.end}
              color={color}
              value={value}
              max={maxLight}
            />
          );
        })}
        {geometry.cliffSegments.map((seg) => (
          <ArcSegment
            key={seg.label}
            cx={geometry.centerX}
            cy={geometry.centerY}
            rInner={geometry.cliffRingInner}
            rOuter={geometry.cliffRingOuter}
            startDeg={seg.start}
            endDeg={seg.end}
            color={cliffColor(telemetry[seg.valueKey], telemetry[seg.activeKey])}
            opacity={1}
            pulse={Boolean(telemetry[seg.activeKey])}
          />
        ))}
        <ArcSegment
          cx={geometry.centerX}
          cy={geometry.centerY}
          rInner={geometry.lightRingInner - bumpLeftOffset}
          rOuter={geometry.lightRingOuter - bumpLeftOffset}
          startDeg={-70}
          endDeg={-6}
          color={telemetry.bumpLeft ? '#ef4444' : '#475569'}
          opacity={1}
          pulse={Boolean(telemetry.bumpLeft)}
        />
        <ArcSegment
          cx={geometry.centerX}
          cy={geometry.centerY}
          rInner={geometry.lightRingInner - bumpRightOffset}
          rOuter={geometry.lightRingOuter - bumpRightOffset}
          startDeg={6}
          endDeg={70}
          color={telemetry.bumpRight ? '#ef4444' : '#475569'}
          opacity={1}
          pulse={Boolean(telemetry.bumpRight)}
        />
      </svg>
    </div>
  );
}

export default React.memo(TopDownMapContent);
