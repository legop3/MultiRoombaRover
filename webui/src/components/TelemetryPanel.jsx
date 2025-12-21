import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useTelemetryFrame } from '../context/TelemetryContext.jsx';
import RoverRoster from './RoverRoster.jsx';

function formatMetric(value, fallback = '--') {
  if (value == null || value === '') return fallback;
  return value;
}

export default function TelemetryPanel() {
  const { connected, session, requestControl } = useSession();
  const roverId = session?.assignment?.roverId;
  const frame = useTelemetryFrame(roverId);
  const sensors = frame?.sensors || {};
  const voltage = sensors.voltageMv != null ? `${(sensors.voltageMv / 1000).toFixed(2)} V` : null;
  const current = sensors.currentMa != null ? `${sensors.currentMa} mA` : null;
  const batteryTemp = sensors.batteryTemperatureC != null ? `${sensors.batteryTemperatureC} °C` : null;
  const charge = sensors.batteryChargeMah;
  const capacity = sensors.batteryCapacityMah;
  const updated = frame?.receivedAt ? new Date(frame.receivedAt).toLocaleTimeString() : null;
  // const rawSnippet = frame?.raw ? (frame.raw.length > 80 ? `${frame.raw.slice(0, 80)}…` : frame.raw) : null;
  const rawSnippet = frame?.raw ? frame.raw : null;
  const roster = session?.roster ?? [];
  const activeDriverId = roverId ? session?.activeDrivers?.[roverId] : null;
  const driverLabel = useMemo(() => {
    if (!roverId) return 'n/a';
    if (!activeDriverId) return 'Available';
    if (activeDriverId === session?.socketId) return 'You';
    const user = (session?.users || []).find((entry) => entry.socketId === activeDriverId);
    return user?.nickname || activeDriverId.slice(0, 6);
  }, [activeDriverId, roverId, session?.socketId, session?.users]);
  const canRequest = useMemo(() => session?.role && session.role !== 'spectator', [session?.role]);
  const [pending, setPending] = useState({});

  async function handleRequest(roverId) {
    if (!roverId) return;
    setPending((prev) => ({ ...prev, [roverId]: true }));
    try {
      await requestControl(roverId);
    } catch (err) {
      alert(err.message);
    } finally {
      setPending((prev) => ({ ...prev, [roverId]: false }));
    }
  }

  return (
    <section className="panel-section space-y-0.5 text-base text-slate-100">
      <div className="text-sm text-slate-400">
        <span>{connected ? 'online' : 'offline'}</span>
        <span> · role {session?.role || 'unknown'}</span>
        <span> · mode {session?.mode || '--'}</span>
        {updated && <span> · sensors {updated}</span>}
        <span> · driver {driverLabel}</span>
      </div>
      {!roverId ? (
        <p className="text-sm text-slate-500">Assign a rover to view sensors.</p>
      ) : !frame ? (
        <p className="text-sm text-slate-500">Waiting for sensor frames…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-0.5 text-sm">
            <Metric label="Charge" value={formatMetric(charge != null && capacity != null ? `${charge}/${capacity}` : null)} />
            <Metric label="Charging" value={formatMetric(sensors.chargingState?.label)} />
            <Metric label="OI mode" value={formatMetric(sensors.oiMode?.label)} />
            <Metric label="Voltage" value={formatMetric(voltage)} />
            <Metric label="Current" value={formatMetric(current)} />
            <Metric label="Temp" value={formatMetric(batteryTemp)} />
            <Metric label="Left Encoder" value={formatMetric(sensors.encoderCountsLeft)} />
            <Metric label="Right Encoder" value={formatMetric(sensors.encoderCountsRight)} />
          </div>
          <SituationalMap sensors={sensors} variant="full" />

          <div className="surface flex flex-col gap-0.5 text-sm">
            <div className="flex gap-0.5">
              <DirtMeter label="Dirt Detect" value={sensors.dirtDetect} />
              <DirtMeter label="Dirt Left" value={sensors.dirtDetectLeft} />
            </div>
            <div className="flex gap-0.5">
              <IrPill label="IR Omni" value={sensors.infraredCharacterOmni} />
              <IrPill label="IR Left" value={sensors.infraredCharacterLeft} />
              <IrPill label="IR Right" value={sensors.infraredCharacterRight} />
            </div>
          </div>
        </>
      )}



      {rawSnippet && (
        // console.log('rawSnippet:', rawSnippet),
        <pre className="surface whitespace-pre-wrap break-words text-xs text-lime-300">
          {rawSnippet}
        </pre>
      )}
      <RoverRoster
        title="Rovers"
        roster={roster}
        renderActions={(rover) =>
          canRequest ? (
            <button
              type="button"
              onClick={() => handleRequest(rover.id)}
              disabled={pending[rover.id]}
              className="button-dark disabled:opacity-40"
            >
              {pending[rover.id] ? '...' : 'request'}
            </button>
          ) : null
        }
      />
    </section>
  );
}

function CliffBar({ value }) {
  // Render a small vertical bar; value is clamped to 0-100 for display
  // const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  // goes from 0 to 4095. calculate percentage for height
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 4095) * 100));
  const height = `${pct}%`;
  return (
    // <div className="surface-muted h-6 w-1/4 relative">
    //   <div className="w-full bg-amber-500 absolute inset-0" style={{ height }} />
    // </div>

    <div className="flex flex-col items-center gap-0.5 w-1/4">
      {/* <span className="text-sm text-slate-200">{label}</span> */}
      <div className="surface-muted h-6 w-full relative">
        <div className={`absolute top-0 left-0 right-0 bg-amber-500`} style={{ height }} />
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white">
          {value != null ? `${value}` : '--'}
        </div>
      </div>
    </div>

  );
}

function Metric({ label, value }) {
  return (
    <div className="surface text-sm">
      {label}: {value}
    </div>
  );
}

// a reusable motor current bar, with overcurrent coloring. Use the overcurrent from sensors for each motor.
// include a label to indicate which motor it is, with the label to the left of the bar
function MotorCurrentBar({ label, value, overcurrent }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 1000) * 100));
  const height = `${pct}%`;
  const barColor = overcurrent ? 'bg-red-500' : 'bg-emerald-500';
  return (
    <div className="flex flex-col items-center gap-0.5 w-1/4">
      <span className="text-sm text-slate-200">{label}</span>
      <div className="surface-muted h-6 w-full relative">
        <div className={`${barColor} absolute bottom-0 left-0 right-0`} style={{ height }} />
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white">
          {value != null ? `${value} mA` : '--'}
        </div>
      </div>
    </div>
  );
}

function DirtMeter({ label, value }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 255) * 100));
  const width = `${pct}%`;
  return (
    <div className="surface-muted relative flex-1 overflow-hidden px-0.5 py-0.25">
      <div className="absolute inset-0 flex items-center">
        <div className="bg-amber-500 h-full" style={{ width }} />
      </div>
      <div className="relative flex items-center justify-between text-xs text-white">
        <span>{label}</span>
        <span>{value != null ? value : '--'}</span>
      </div>
    </div>
  );
}

function IrPill({ label, value }) {
  return (
    <div className="surface px-1 py-0.5 text-xs text-white">
      {label}: {value != null && value !== 0 ? value : '--'}
    </div>
  );
}

function SituationalMap({ sensors, variant = 'full' }) {
  const size = variant === 'mini' ? 190 : 240;
  const center = size / 2;
  const innerCircle = variant === 'mini' ? 78 : 96;
  const lightRingInner = variant === 'mini' ? 68 : 82;
  const lightRingOuter = variant === 'mini' ? 78 : 92;
  const cliffRingInner = variant === 'mini' ? 58 : 72;
  const cliffRingOuter = variant === 'mini' ? 68 : 82;
  const bumpRingInner = variant === 'mini' ? 82 : 104;
  const bumpRingOuter = variant === 'mini' ? 90 : 114;
  const wheelLineOffset = variant === 'mini' ? 34 : 42;

  const lightSignals = [
    sensors?.lightBumpLeftSignal,
    sensors?.lightBumpFrontLeftSignal,
    sensors?.lightBumpCenterLeftSignal,
    sensors?.lightBumpCenterRightSignal,
    sensors?.lightBumpFrontRightSignal,
    sensors?.lightBumpRightSignal,
  ].filter((v) => v != null);
  const observedLightMax = lightSignals.length ? Math.max(...lightSignals) : 0;
  const effectiveLightMax = Math.max(observedLightMax, 1200); // adaptive gain; these rarely hit 4095
  const bumps = sensors?.bumpsAndWheelDrops || {};
  const wheelCurrentLeft = sensors?.wheelLeftCurrentMa ?? 0;
  const wheelCurrentRight = sensors?.wheelRightCurrentMa ?? 0;
  const sideBrushCurrent = sensors?.sideBrushCurrentMa ?? 0;
  const mainBrushCurrent = sensors?.mainBrushCurrentMa ?? 0;
  const wheelOver = sensors?.wheelOvercurrents || {};

  const lightSegments = [
    { label: 'L', start: -100, end: -70, value: sensors?.lightBumpLeftSignal, active: sensors?.lightBumper?.left },
    { label: 'FL', start: -70, end: -35, value: sensors?.lightBumpFrontLeftSignal, active: sensors?.lightBumper?.frontLeft },
    { label: 'CL', start: -35, end: -5, value: sensors?.lightBumpCenterLeftSignal, active: sensors?.lightBumper?.centerLeft },
    { label: 'CR', start: 5, end: 35, value: sensors?.lightBumpCenterRightSignal, active: sensors?.lightBumper?.centerRight },
    { label: 'FR', start: 35, end: 70, value: sensors?.lightBumpFrontRightSignal, active: sensors?.lightBumper?.frontRight },
    { label: 'R', start: 70, end: 100, value: sensors?.lightBumpRightSignal, active: sensors?.lightBumper?.right },
  ];

  const cliffSegments = [
    { label: 'Cliff L', start: -95, end: -70, value: sensors?.cliffLeftSignal, active: sensors?.cliffLeft },
    { label: 'Cliff FL', start: -45, end: -15, value: sensors?.cliffFrontLeftSignal, active: sensors?.cliffFrontLeft },
    { label: 'Cliff FR', start: 15, end: 45, value: sensors?.cliffFrontRightSignal, active: sensors?.cliffFrontRight },
    { label: 'Cliff R', start: 70, end: 95, value: sensors?.cliffRightSignal, active: sensors?.cliffRight },
  ];

  return (
    <div className="surface relative p-1" style={{ height: variant === 'mini' ? '12rem' : '15rem' }}>
      <div className="absolute left-1 top-1 text-xs text-slate-400">Top-down</div>
      <div className="absolute right-1 top-1 text-[0.65rem] text-slate-500">0–{effectiveLightMax}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
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
        {lightSegments.map((seg) => {
          const pct = seg.value == null ? 0 : Math.max(0, Math.min(1, seg.value / effectiveLightMax));
          const color = pct > 0.75 ? '#f59e0b' : '#22c55e';
          return (
            <ArcSegment
              key={seg.label}
              cx={center}
              cy={center}
              rInner={lightRingInner}
              rOuter={lightRingOuter}
              startDeg={seg.start}
              endDeg={seg.end}
              color={seg.value == null ? '#475569' : color}
              opacity={seg.value == null ? 0.35 : 0.95}
              pulse={Boolean(seg.active)}
            />
          );
        })}
        {cliffSegments.map((seg) => {
          const pct = seg.value == null ? 0 : Math.max(0, Math.min(1, seg.value / 4095));
          const color = pct > 0.6 ? '#f59e0b' : '#22c55e';
          return (
            <ArcSegment
              key={seg.label}
              cx={center}
              cy={center}
              rInner={cliffRingInner}
              rOuter={cliffRingOuter}
              startDeg={seg.start}
              endDeg={seg.end}
              color={seg.value == null ? '#475569' : color}
              opacity={seg.value == null ? 0.35 : 0.9}
              pulse={Boolean(seg.active)}
            />
          );
        })}
        <ArcSegment
          cx={center}
          cy={center}
          rInner={bumpRingInner}
          rOuter={bumpRingOuter}
          startDeg={-80}
          endDeg={-25}
          color={bumps.bumpLeft ? '#ef4444' : '#475569'}
          opacity={bumps.bumpLeft ? 0.9 : 0.7}
          pulse={Boolean(bumps.bumpLeft)}
        />
        <ArcSegment
          cx={center}
          cy={center}
          rInner={bumpRingInner}
          rOuter={bumpRingOuter}
          startDeg={25}
          endDeg={80}
          color={bumps.bumpRight ? '#ef4444' : '#475569'}
          opacity={bumps.bumpRight ? 0.9 : 0.7}
          pulse={Boolean(bumps.bumpRight)}
        />
        <SideBrushVisual
          cx={center + innerCircle * 0.45}
          cy={center - innerCircle * 0.35}
          current={sideBrushCurrent}
          overcurrent={wheelOver.sideBrush}
        />
        <MainBrushVisual
          cx={center}
          cy={center + innerCircle * 0.25}
          current={mainBrushCurrent}
          overcurrent={wheelOver.mainBrush}
          variant={variant}
        />
        <text x={center} y={18} textAnchor="middle" className="fill-slate-500 text-[0.6rem]">
          N
        </text>
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
          opacity={0.6}
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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function currentColor(value, overcurrent) {
  if (overcurrent) return '#ef4444';
  const mag = Math.abs(value);
  if (mag > 900) return '#f59e0b';
  if (mag > 300) return '#22c55e';
  return '#94a3b8';
}

function WheelVisual({ cx, cy, current, drop, overcurrent, label }) {
  const mag = Math.abs(current);
  const pct = clamp01(mag / 1200);
  const color = currentColor(current, overcurrent);
  const barH = 30;
  const currentW = 12;
  const dropW = 8;
  const gap = 4;
  const currentFill = barH * pct;
  const sign = label === 'L' ? -1 : 1;
  const currentCenterX = sign * (-dropW / 2 - gap / 2);
  const dropCenterX = sign * (currentW / 2 + gap / 2);
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect
        x={currentCenterX - currentW / 2}
        y={-barH / 2}
        width={currentW}
        height={barH}
        fill="#0f172a"
        stroke="#1f2937"
        strokeWidth="1"
        rx="2"
      />
      <rect
        x={currentCenterX - currentW / 2}
        y={barH / 2 - currentFill}
        width={currentW}
        height={currentFill}
        fill={color}
        className={overcurrent ? 'animate-pulse' : ''}
      />
      <rect
        x={dropCenterX - dropW / 2}
        y={-barH / 2}
        width={dropW}
        height={barH}
        fill={drop ? '#ef4444' : '#475569'}
        className={drop ? 'animate-pulse' : ''}
        rx="2"
      />
      <text x={0} y={barH / 2 + 10} textAnchor="middle" className="fill-slate-200 text-[0.7rem]">
        {label}
      </text>
    </g>
  );
}

function SideBrushVisual({ cx, cy, current, overcurrent }) {
  const mag = Math.abs(current);
  const color = currentColor(current, overcurrent);
  const opacity = clamp01(mag / 1000) * 0.6 + 0.3;
  const armLength = 26;
  const spinDuration = mag > 10 ? Math.max(0.35, 2.2 - mag / 500) : null;
  return (
    <g
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        animation: spinDuration ? `spin ${spinDuration}s linear infinite` : 'none',
      }}
    >
      <circle cx={cx} cy={cy} r={10} fill="#0f172a" stroke={color} strokeWidth="2" opacity={opacity} />
      {[0, 120, 240].map((deg) => {
        const rad = toRad(deg);
        const x2 = cx + armLength * Math.cos(rad);
        const y2 = cy + armLength * Math.sin(rad);
        return <line key={deg} x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth="4" strokeLinecap="round" opacity={opacity} />;
      })}
      {overcurrent ? <circle cx={cx} cy={cy} r={armLength + 6} stroke="#ef4444" strokeWidth="3" fill="none" className="animate-pulse" opacity={0.6} /> : null}
    </g>
  );
}

function MainBrushVisual({ cx, cy, current, overcurrent, variant }) {
  const mag = Math.abs(current);
  const color = currentColor(current, overcurrent);
  const opacity = clamp01(mag / 1000) * 0.6 + 0.3;
  const rollerWidth = 44;
  const rollerHeight = 8;
  const patternA = `main-brush-pattern-a-${variant}`;
  const patternB = `main-brush-pattern-b-${variant}`;
  const dur = mag > 10 ? Math.max(0.35, 2.4 - mag / 500) : null;
  const dir = current >= 0 ? 1 : -1;
  return (
    <g>
      <defs>
        {[patternA, patternB].map((id, idx) => (
          <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="6" height="6">
            <rect width="6" height="6" fill={color} opacity={opacity} />
            <path d="M0 6 L6 0" stroke="#0f172a" strokeWidth="1" />
            {dur ? (
              <animateTransform
                attributeName="patternTransform"
                type="translate"
                from="0 0"
                to={`0 ${dir * (idx === 0 ? 6 : -6)}`}
                dur={`${dur}s`}
                repeatCount="indefinite"
              />
            ) : null}
          </pattern>
        ))}
      </defs>
      <rect
        x={cx - rollerWidth / 2}
        y={cy - 12}
        width={rollerWidth}
        height={rollerHeight}
        rx="3"
        fill={`url(#${patternA})`}
        stroke="#0f172a"
        strokeWidth="1"
      />
      <rect
        x={cx - rollerWidth / 2}
        y={cy + 6}
        width={rollerWidth}
        height={rollerHeight}
        rx="3"
        fill={`url(#${patternB})`}
        stroke="#0f172a"
        strokeWidth="1"
      />
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
          opacity={0.6}
        />
      ) : null}
    </g>
  );
}
