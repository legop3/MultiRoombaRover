// Fleet Time Series Chart
// Purpose: Adapts uPlot to minute-level fleet evidence with exact cursor values and drag-to-zoom inspection.
// Scope: Owns chart lifecycle and aligned-series preparation; server calculations remain authoritative and tables retain exact evidence.
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const SERIES_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#fb7185', '#60a5fa', '#facc15', '#c084fc'];

export default function FleetTimeSeriesChart({ minutes = [], roverIds = [], metric = 'dischargedMah' }) {
  const elementRef = useRef(null);
  const prepared = useMemo(() => {
    // uPlot uses aligned arrays for speed. Constructing one timestamp axis and
    // sparse value arrays lets it render long report ranges efficiently while
    // retaining nulls as visible telemetry gaps instead of joining them.
    const timestamps = Array.from(new Set(minutes.map((row) => Number(row.bucketTs) / 1000))).sort((a, b) => a - b);
    const timestampIndexes = new Map(timestamps.map((value, index) => [value, index]));
    const rowsByRover = new Map(roverIds.map((roverId) => [String(roverId), new Array(timestamps.length).fill(null)]));
    minutes.forEach((row) => {
      const values = rowsByRover.get(String(row.roverId));
      const index = timestampIndexes.get(Number(row.bucketTs) / 1000);
      if (!values || index == null) return;
      values[index] = row[metric] == null ? null : Number(row[metric]);
    });
    return {
      data: [timestamps, ...roverIds.map((roverId) => rowsByRover.get(String(roverId)))],
      series: roverIds.map((roverId, index) => ({
        label: String(roverId),
        stroke: SERIES_COLORS[index % SERIES_COLORS.length],
        width: 1.5,
        spanGaps: false,
        value: (_self, value) => value == null ? '--' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }),
      })),
    };
  }, [metric, minutes, roverIds]);

  useEffect(() => {
    if (!elementRef.current || !prepared.data[0].length) return undefined;
    const container = elementRef.current;
    const metricLabels = {
      dischargedMah: 'Discharged mAh/min',
      chargedMah: 'Charged mAh/min',
      avgVoltageMv: 'Average voltage mV',
      avgCurrentMa: 'Average current mA',
      avgTemperatureC: 'Average temperature °C',
    };
    const chart = new uPlot({
      width: Math.max(320, container.clientWidth),
      height: 384,
      title: metricLabels[metric] || metric,
      cursor: { drag: { x: true, y: false, setScale: true } },
      legend: { show: true, live: true },
      axes: [
        { stroke: '#94a3b8', grid: { stroke: 'rgba(115,115,115,0.22)' } },
        { stroke: '#94a3b8', grid: { stroke: 'rgba(115,115,115,0.22)' } },
      ],
      scales: { x: { time: true } },
      series: [{ label: 'Time' }, ...prepared.series],
      hooks: {
        ready: [(plot) => {
          // Dragging selects a time range through uPlot itself. Double-clicking
          // restores the full evidence window without adding custom graph math.
          plot.root.addEventListener('dblclick', () => plot.setScale('x', { min: null, max: null }));
        }],
      },
    }, prepared.data, container);
    const observer = new ResizeObserver(() => {
      chart.setSize({ width: Math.max(320, container.clientWidth), height: 384 });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [metric, prepared]);

  if (!prepared.data[0].length) {
    return <p className="surface p-1 text-sm text-slate-400">No minute time-series data in this range.</p>;
  }
  return (
    <div>
      <p className="mb-0.5 text-[0.68rem] text-slate-400">Drag horizontally to zoom. Double-click to restore the full range. Hover for exact values.</p>
      <div ref={elementRef} className="min-h-[24rem] w-full overflow-hidden text-slate-200" role="img" aria-label={`Fleet time series for ${metric}`} />
    </div>
  );
}
