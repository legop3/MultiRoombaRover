import { useMemo } from 'react';
import { useDockIr } from '../hooks/useDockIr.js';

const SVG_SIZE = 120;
const SVG_HEIGHT = 120;
const CENTER_X = SVG_SIZE / 2;
const DOCK_Y = 18;
const ROVER_Y = 90;

function lobePath(side = 'left') {
  if (side === 'left') {
    return `M ${CENTER_X} ${DOCK_Y} C ${CENTER_X - 22} ${DOCK_Y + 18} ${CENTER_X - 28} ${ROVER_Y - 16} ${CENTER_X - 8} ${ROVER_Y} L ${CENTER_X} ${ROVER_Y} Z`;
  }
  return `M ${CENTER_X} ${DOCK_Y} C ${CENTER_X + 22} ${DOCK_Y + 18} ${CENTER_X + 28} ${ROVER_Y - 16} ${CENTER_X + 8} ${ROVER_Y} L ${CENTER_X} ${ROVER_Y} Z`;
}

export default function DockAssistHUD({ sensors }) {
  const state = useDockIr(sensors);
  const lobe = useMemo(
    () => ({
      left: {
        base: 'rgba(16, 185, 129, 0.15)',
        active: 'rgba(16, 185, 129, 0.55)',
        outline: 'rgba(52, 211, 153, 0.9)',
      },
      right: {
        base: 'rgba(239, 68, 68, 0.15)',
        active: 'rgba(239, 68, 68, 0.55)',
        outline: 'rgba(248, 113, 113, 0.9)',
      },
      force: {
        halo: 'rgba(59, 130, 246, 0.15)',
        haloStrong: 'rgba(59, 130, 246, 0.35)',
        outline: 'rgba(191, 219, 254, 0.8)',
      },
      rover: {
        body: '#111827',
        fill: '#e5e7eb',
      },
    }),
    [],
  );

  if (!state.visible) {
    return null;
  }

  const nudge = state.balance * 6; // pixels to offset rover cue
  const leftGlow = state.left.red || state.left.green || state.left.force;
  const rightGlow = state.right.red || state.right.green || state.right.force;
  const aligned = state.left.red && state.left.green && state.right.red && state.right.green && state.forceDetected;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-0.25">
      <div className="rounded bg-black/70 px-0.5 py-0.25 shadow-md shadow-black/40 ring-1 ring-white/5">
        <svg width={SVG_SIZE} height={SVG_HEIGHT} viewBox={`0 0 ${SVG_SIZE} ${SVG_HEIGHT}`} role="img" aria-label="Docking assist">
          {/* Force field halo */}
          <circle
            cx={CENTER_X}
            cy={DOCK_Y + 6}
            r={20}
            fill={state.forceDetected ? lobe.force.haloStrong : lobe.force.halo}
            stroke={state.forceDetected ? lobe.force.outline : 'none'}
            strokeWidth={state.forceDetected ? 2 : 0}
          />

          {/* Left lobe */}
          <path d={lobePath('left')} fill={leftGlow ? lobe.left.active : lobe.left.base} />
          {aligned && <path d={lobePath('left')} fill="none" stroke={lobe.left.outline} strokeWidth={1.5} />}

          {/* Right lobe */}
          <path d={lobePath('right')} fill={rightGlow ? lobe.right.active : lobe.right.base} />
          {aligned && <path d={lobePath('right')} fill="none" stroke={lobe.right.outline} strokeWidth={1.5} />}

          {/* Dock icon */}
          <rect x={CENTER_X - 12} y={DOCK_Y - 8} width="24" height="10" rx="2" fill="#1f2937" stroke="#6b7280" strokeWidth="0.8" />
          <circle cx={CENTER_X - 5} cy={DOCK_Y - 3.5} r="1.5" fill="#9ca3af" />
          <circle cx={CENTER_X + 5} cy={DOCK_Y - 3.5} r="1.5" fill="#9ca3af" />

          {/* Rover cue */}
          <g transform={`translate(${CENTER_X + nudge}, ${ROVER_Y})`}>
            <circle r="7" fill={lobe.rover.body} stroke="#6b7280" strokeWidth="1.2" />
            <path d="M 0 -5 L 4 4 L -4 4 Z" fill={lobe.rover.fill} />
          </g>

          {/* Nudge arrow */}
          {state.bias !== 'center' && (
            <path
              d={
                state.bias === 'left'
                  ? `M ${CENTER_X - 14} ${ROVER_Y - 6} L ${CENTER_X - 22} ${ROVER_Y} L ${CENTER_X - 14} ${ROVER_Y + 6}`
                  : `M ${CENTER_X + 14} ${ROVER_Y - 6} L ${CENTER_X + 22} ${ROVER_Y} L ${CENTER_X + 14} ${ROVER_Y + 6}`
              }
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

        </svg>
      </div>
    </div>
  );
}
