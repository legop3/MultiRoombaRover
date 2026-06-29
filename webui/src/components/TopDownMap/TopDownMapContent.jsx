// Top Down Map Content
// Purpose: Defines the Top Down Map Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import React, { useMemo } from 'react';
import { buildSegments } from './helpers.js';
import BumpLayer from './layers/BumpLayer/index.jsx';
import CliffLayer from './layers/CliffLayer/index.jsx';
import ElectricalReadoutLayer from './layers/ElectricalReadoutLayer/index.jsx';
import LightBumpLayer from './layers/LightBumpLayer/index.jsx';
import MainBrushLayer from './layers/MainBrushLayer/index.jsx';
// import RawFrameStripLayer from './layers/RawFrameStripLayer/index.jsx';
import SideBrushLayer from './layers/SideBrushLayer/index.jsx';
import WheelLayer from './layers/WheelLayer/index.jsx';

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
  // The body circle consumes almost the whole square, especially in the HUD
  // overlay where the map is scaled down. The bottom corners are the only
  // reliable empty spaces, so new telemetry is anchored there instead of adding
  // separate HUD/non-HUD layouts that would drift apart over time.
  const maxCornerReadoutWidth = size * 0.46;
  const readoutWidth = Math.min(maxCornerReadoutWidth, Math.max(96, size * 0.42));
  const readoutHeight = Math.max(18, size * 0.08);
  const readoutInset = Math.max(6, size * 0.03);
  const bottomReadoutY = size - readoutInset - readoutHeight;
  const rawFrameStripWidth = innerCircle * 1.05;
  const rawFrameStripHeight = Math.max(13, size * 0.055);
  const rawFrameStripY = centerY + innerCircle * 0.38;

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
    voltageReadout: {
      x: readoutInset,
      y: bottomReadoutY,
      width: readoutWidth,
      height: readoutHeight,
    },
    currentReadout: {
      x: size - readoutInset - readoutWidth,
      y: bottomReadoutY,
      width: readoutWidth,
      height: readoutHeight,
    },
    // rawFrameStrip: {
    //   x: centerX - rawFrameStripWidth / 2,
    //   y: rawFrameStripY,
    //   width: rawFrameStripWidth,
    //   height: rawFrameStripHeight,
    // },
    lightSegments: lightAngles.map((angle, idx) => ({
      label: LIGHT_LABELS[idx],
      start: angle.start,
      end: angle.end,
    })),
    cliffSegments: [
      { label: 'Cliff L', start: -60, end: -46, valueKey: 'cliffLeftSignal', activeKey: 'cliffLeft', fillFromEnd: true },
      { label: 'Cliff FL', start: -32, end: -16, valueKey: 'cliffFrontLeftSignal', activeKey: 'cliffFrontLeft', fillFromEnd: true },
      { label: 'Cliff FR', start: 16, end: 32, valueKey: 'cliffFrontRightSignal', activeKey: 'cliffFrontRight', fillFromEnd: false },
      { label: 'Cliff R', start: 46, end: 60, valueKey: 'cliffRightSignal', activeKey: 'cliffRight', fillFromEnd: false },
    ],
  };
}

function TopDownMapContent({ roverId = null, sensors = null, variant = 'full', size: overrideSize, overlay = false }) {
  const size = overrideSize || (variant === 'mini' ? 190 : 260);
  const geometry = useMemo(() => buildGeometry(size, variant), [size, variant]);

  return (
    <div
      className={`${overlay ? 'relative' : 'relative p-1'}`}
      style={overlay ? { width: `${size}px`, height: `${size}px` } : { height: '100%', width: '100%', aspectRatio: '1 / 1' }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block">
        <circle cx={geometry.centerX} cy={geometry.centerY} r={geometry.innerCircle} fill="#0f172a" stroke="#334155" strokeWidth="2" />
        <WheelLayer roverId={roverId} sensors={sensors} geometry={geometry} />
        <SideBrushLayer roverId={roverId} sensors={sensors} geometry={geometry} />
        <MainBrushLayer roverId={roverId} sensors={sensors} geometry={geometry} variant={variant} />
        {/* <RawFrameStripLayer roverId={sensors ? null : roverId} geometry={geometry} /> */}
        <LightBumpLayer roverId={roverId} sensors={sensors} geometry={geometry} />
        <CliffLayer roverId={roverId} sensors={sensors} geometry={geometry} />
        <BumpLayer roverId={roverId} sensors={sensors} geometry={geometry} />
        <ElectricalReadoutLayer roverId={roverId} sensors={sensors} geometry={geometry} />
      </svg>
    </div>
  );
}

export default React.memo(TopDownMapContent);
