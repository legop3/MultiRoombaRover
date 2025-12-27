import { useMemo } from 'react';
import { useDockIr } from '../hooks/useDockIr.js';

const SVG_W = 120;
const SVG_H = 96;
const CX = SVG_W / 2;
const DOCK_Y = 14;
const ROVER_Y = 74;

function alignmentBarPath() {
  return `M ${CX - 3} ${DOCK_Y + 4} L ${CX - 10} ${ROVER_Y - 6} L ${CX + 10} ${ROVER_Y - 6} Z`;
}

export default function DockAssistHUD({ sensors }) {
  const state = useDockIr(sensors);
  const palette = useMemo(
    () => ({
      green: ['rgba(16,185,129,0.6)', 'rgba(16,185,129,0.45)', 'rgba(16,185,129,0)'],
      red: ['rgba(239,68,68,0.6)', 'rgba(239,68,68,0.45)', 'rgba(239,68,68,0)'],
      forceOutline: 'rgba(191,219,254,0.85)',
      roverBody: '#0f172a',
      roverFill: '#e5e7eb',
    }),
    [],
  );

  if (!state.visible) return null;

  const nudge = state.balance * 5;
  const leftHit = state.left.active;
  const rightHit = state.right.active;
  const forceHit = state.omni.force || state.forceDetected;
  const allAligned = Boolean(state.left.green && state.right.red && state.omni.force);
  const hasAny = leftHit || rightHit || forceHit;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-0.25">
      <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} role="img" aria-label="Docking assist">
        <defs>
          <linearGradient id="alignGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(148,163,184,0.9)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0)" />
          </linearGradient>
        </defs>

        {/* Alignment wedge */}
        {hasAny ? (
          <path
            d={alignmentBarPath()}
            fill="url(#alignGrad)"
            transform={`translate(${nudge * 3}, 0) rotate(${state.balance * 8}, ${CX}, ${ROVER_Y - 6})`}
          />
        ) : null}

        {/* Dock icon: simple rounded square with symmetric top corners */}
        <path
          d={`
            M ${CX - 16} ${DOCK_Y - 10}
            Q ${CX - 12} ${DOCK_Y - 14} ${CX - 6} ${DOCK_Y - 14}
            H ${CX + 6}
            Q ${CX + 12} ${DOCK_Y - 14} ${CX + 16} ${DOCK_Y - 10}
            L ${CX + 16} ${DOCK_Y + 10}
            Q ${CX + 16} ${DOCK_Y + 22} ${CX} ${DOCK_Y + 24}
            Q ${CX - 16} ${DOCK_Y + 22} ${CX - 16} ${DOCK_Y + 10}
            Z
          `}
          fill="#0b1220"
          stroke="#94a3b8"
          strokeWidth="0.8"
        />
        {/* Force field emitter dot */}
        <circle cx={CX} cy={DOCK_Y - 6} r="2.1" fill="#60a5fa" />
        {/* Contacts */}
        <rect x={CX - 10} y={DOCK_Y + 8} width="3.2" height="8.5" rx="1" fill="#e2e8f0" />
        <rect x={CX + 6.5} y={DOCK_Y + 8} width="3.2" height="8.5" rx="1" fill="#e2e8f0" />

        {/* Force field halo on top */}
        <circle
          cx={CX}
          cy={DOCK_Y - 4}
          r={18}
          fill={state.forceDetected ? 'url(#halo)' : 'rgba(59,130,246,0.12)'}
          stroke={state.forceDetected ? palette.forceOutline : 'none'}
          strokeWidth={state.forceDetected ? 1.2 : 0}
        />

        {/* Rover cue */}
        <g transform={`translate(${CX + nudge}, ${ROVER_Y})`}>
          <circle r="6" fill={palette.roverBody} stroke="#6b7280" strokeWidth="1" />
          <path d="M 0 -5 L 4 4 L -4 4 Z" fill={palette.roverFill} />
        </g>

        {/* Nudge arrow */}
        {state.bias !== 'center' && (
          <path
            d={
              state.bias === 'left'
                ? `M ${CX - 12} ${ROVER_Y - 5} L ${CX - 18} ${ROVER_Y} L ${CX - 12} ${ROVER_Y + 5}`
                : `M ${CX + 12} ${ROVER_Y - 5} L ${CX + 18} ${ROVER_Y} L ${CX + 12} ${ROVER_Y + 5}`
            }
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Thumbs up when fully aligned */}
        {allAligned ? <text x={CX + 30} y={DOCK_Y + 8} fontSize="12" fill="#fbbf24" fontFamily="sans-serif">👍</text> : null}
      </svg>
    </div>
  );
}
