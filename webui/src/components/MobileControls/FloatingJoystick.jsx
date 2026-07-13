// Floating Drive Pad
// Purpose: Provides a one-thumb mobile drive surface that emits keyboard-style fixed drive intents.
// Scope: Owns pointer tracking, fixed overlay positioning, and active 3x3 drive-zone feedback.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PAD_MARGIN = 12;
const CELL_COUNT = 3;
const DEFAULT_PAD_SIZE = 180;

const DRIVE_CELLS = [
  { id: 'forward-left', label: 'fwd left', col: 0, row: 0, actions: ['driveForward', 'driveLeft'] },
  { id: 'forward', label: 'fwd', col: 1, row: 0, actions: ['driveForward'] },
  { id: 'forward-right', label: 'fwd right', col: 2, row: 0, actions: ['driveForward', 'driveRight'] },
  { id: 'left', label: 'left', col: 0, row: 1, actions: ['driveLeft'] },
  { id: 'stop', label: 'stop', col: 1, row: 1, actions: [] },
  { id: 'right', label: 'right', col: 2, row: 1, actions: ['driveRight'] },
  { id: 'back-left', label: 'back left', col: 0, row: 2, actions: ['driveBackward', 'driveLeft'] },
  { id: 'back', label: 'back', col: 1, row: 2, actions: ['driveBackward'] },
  { id: 'back-right', label: 'back right', col: 2, row: 2, actions: ['driveBackward', 'driveRight'] },
];

const DRIVE_CELL_BY_POSITION = DRIVE_CELLS.reduce((lookup, cell) => {
  lookup[`${cell.row}:${cell.col}`] = cell;
  return lookup;
}, {});

const STOP_CELL = DRIVE_CELLS.find((cell) => cell.id === 'stop');

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getViewportSize() {
  if (typeof window === 'undefined') return { width: DEFAULT_PAD_SIZE, height: DEFAULT_PAD_SIZE };
  return {
    width: window.innerWidth || DEFAULT_PAD_SIZE,
    height: window.innerHeight || DEFAULT_PAD_SIZE,
  };
}

function getPadSize(container) {
  if (!container) return DEFAULT_PAD_SIZE;
  const rect = container.getBoundingClientRect();
  const viewport = getViewportSize();
  const availableWidth = Math.max(96, Math.min(rect.width, viewport.width - PAD_MARGIN * 2));

  // The floating grid should match the visible drive card width instead of being a
  // fixed global overlay size. That keeps the active pad visually connected to the
  // card and prevents it from feeling oversized in portrait split-column layouts.
  return Math.round(availableWidth);
}

function clampPadCenter(clientX, clientY, padSize) {
  const viewport = getViewportSize();
  const halfPad = padSize / 2;
  const minX = Math.min(viewport.width - halfPad, halfPad + PAD_MARGIN);
  const maxX = Math.max(halfPad + PAD_MARGIN, viewport.width - halfPad - PAD_MARGIN);
  const minY = Math.min(viewport.height - halfPad, halfPad + PAD_MARGIN);
  const maxY = Math.max(halfPad + PAD_MARGIN, viewport.height - halfPad - PAD_MARGIN);

  // The floating pad is fixed to the viewport instead of the card so overflow-hidden
  // containers cannot clip it. Clamping keeps the visible 3x3 target usable even when
  // the driver starts near the edge of a landscape phone screen.
  return {
    x: clamp(clientX, minX, maxX),
    y: clamp(clientY, minY, maxY),
  };
}

function cellFromPointer(activePad, clientX, clientY) {
  const padSize = activePad?.size || DEFAULT_PAD_SIZE;
  const halfPad = padSize / 2;
  const cellSize = padSize / CELL_COUNT;
  const localX = clamp(clientX - activePad.center.x + halfPad, 0, padSize - 1);
  const localY = clamp(clientY - activePad.center.y + halfPad, 0, padSize - 1);
  const col = clamp(Math.floor(localX / cellSize), 0, CELL_COUNT - 1);
  const row = clamp(Math.floor(localY / cellSize), 0, CELL_COUNT - 1);
  return DRIVE_CELL_BY_POSITION[`${row}:${col}`] || STOP_CELL;
}

function FloatingPadOverlay({ center, size, activeCellId }) {
  if (typeof document === 'undefined') return null;
  const halfPad = size / 2;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1000]" aria-hidden="true">
      <div
        className="absolute grid grid-cols-3 grid-rows-3 overflow-hidden rounded-lg border-2 border-cyan-300/80 bg-slate-950/90 shadow-2xl shadow-cyan-950/50 backdrop-blur-sm"
        style={{
          height: size,
          left: center.x - halfPad,
          top: center.y - halfPad,
          width: size,
        }}
      >
        {DRIVE_CELLS.map((cell) => {
          const active = cell.id === activeCellId;
          const isStop = cell.id === 'stop';
          const baseClass =
            'flex items-center justify-center border border-slate-700/80 px-1 text-center text-xs font-semibold leading-tight';
          const activeClass = active
            ? isStop
              ? 'bg-rose-500 text-white'
              : 'bg-cyan-300 text-slate-950'
            : isStop
            ? 'bg-slate-900 text-slate-300'
            : 'bg-slate-800/80 text-slate-200';
          return (
            <div key={cell.id} className={`${baseClass} ${activeClass}`}>
              {cell.label}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

export default function FloatingJoystick({
  activeInputLabel = 'stop',
  compact = false,
  disabled,
  onCellChange,
  onStop,
}) {
  const containerRef = useRef(null);
  const pointerIdRef = useRef(null);
  const activePadRef = useRef(null);
  const activeCellIdRef = useRef(null);
  const [activePad, setActivePad] = useState(null);

  const stopTracking = useCallback(() => {
    pointerIdRef.current = null;
    activeCellIdRef.current = null;
    setActivePad(null);
    onStop?.();
  }, [onStop]);

  const updateActiveCell = useCallback(
    (event) => {
      const currentPad = activePadRef.current;
      if (!currentPad) return;
      const cell = cellFromPointer(currentPad, event.clientX, event.clientY);
      if (activeCellIdRef.current !== cell.id) {
        activeCellIdRef.current = cell.id;
        onCellChange?.(cell);
      }
      setActivePad({
        ...currentPad,
        activeCellId: cell.id,
      });
    },
    [onCellChange],
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (disabled) return;
      if (pointerIdRef.current !== null) return;
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      pointerIdRef.current = event.pointerId;
      const size = getPadSize(container);
      const center = clampPadCenter(event.clientX, event.clientY, size);
      activePadRef.current = { center, size, activeCellId: STOP_CELL.id };
      container.setPointerCapture?.(event.pointerId);

      // Starting in the center mirrors the old floating joystick behavior: putting
      // a thumb down establishes the control origin, and movement after that chooses
      // a direction. This prevents accidental drive commands from a simple touch.
      activeCellIdRef.current = STOP_CELL.id;
      setActivePad(activePadRef.current);
      onCellChange?.(STOP_CELL);
    },
    [disabled, onCellChange],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (disabled || pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      updateActiveCell(event);
    },
    [disabled, updateActiveCell],
  );

  const handlePointerEnd = useCallback(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      stopTracking();
      containerRef.current?.releasePointerCapture?.(pointerId);
    },
    [stopTracking],
  );

  useEffect(() => {
    if (!disabled) return undefined;

    // Defer visual cleanup so this component stays compatible with the repo's strict
    // React hook lint rules while still guaranteeing that losing rover access stops
    // any active mobile drive gesture.
    const timer = setTimeout(stopTracking, 0);
    return () => clearTimeout(timer);
  }, [disabled, stopTracking]);

  return (
    <>
      <div
        ref={containerRef}
        role="presentation"
        className={`mobile-touch-control mobile-drag-control relative flex h-full w-full select-none items-center justify-center overflow-hidden text-slate-100 ${compact ? 'min-h-[7rem]' : 'min-h-[10rem]'}`}
        // Pointer drags are the whole control model here, so this inline value
        // reinforces the utility class even if future class churn changes it.
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={(event) => {
          if (pointerIdRef.current === event.pointerId) stopTracking();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {!compact ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-slate-700 bg-slate-950 px-1.5 py-0.5 text-center">
            {/* The readout lives inside the pointer target instead of above it, so the
                visual indicator does not consume any non-drivable space on small phones. */}
            <span className="font-mono text-xs font-semibold text-cyan-200">
              {activeInputLabel}
            </span>
          </div>
        ) : null}
        {!compact ? (
          <div className="pointer-events-none flex flex-col items-center gap-0.5 px-2 pt-5 text-center">
            <span className="text-sm font-semibold text-slate-100">drive pad</span>
            <span className="text-xs leading-tight text-slate-300">hold and drag</span>
          </div>
        ) : (
          <div className="pointer-events-none h-8 w-8 rounded-full border border-cyan-300/60 bg-cyan-300/20" />
        )}
      </div>
      {activePad ? (
        <FloatingPadOverlay
          center={activePad.center}
          size={activePad.size}
          activeCellId={activePad.activeCellId}
        />
      ) : null}
    </>
  );
}
