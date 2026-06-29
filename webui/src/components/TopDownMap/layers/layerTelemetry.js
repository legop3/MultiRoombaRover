import { useVisualTelemetrySelector } from '../../../context/TelemetryContext.jsx';

export function rawNumber(value, fallback = null) {
  // Top-down visual layers intentionally consume raw sensor resolution. The
  // visual subscription can still throttle notification cadence for mobile or
  // spectator layouts, but this helper never rounds or buckets the value.
  if (value == null || !Number.isFinite(Number(value))) return fallback;
  return Number(value);
}

export function useTopDownTelemetry(roverId, sensors, selector, equalityFn) {
  // Raw sensor snapshots are kept for fallback/static call sites. Live map
  // rendering should subscribe by rover id, so passing null while raw sensors
  // are supplied avoids a wasted live subscription and keeps hook order stable.
  const selected = useVisualTelemetrySelector(sensors ? null : roverId, selector, equalityFn);
  return sensors ? selector({ sensors }) : selected;
}
