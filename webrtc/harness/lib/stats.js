// Latency Harness Statistics
// Purpose: Summarizes latency samples in the terms a tuning decision actually needs.
// Scope: Pure functions over number arrays.

/*
  Latency is reported as percentiles rather than a mean. A mean hides the case that
  people actually notice: a stream that is usually fine but stalls occasionally
  feels worse than one that is uniformly slightly slower, and only the tail shows
  that difference.
*/
function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(values) {
  const numbers = (values || []).filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null, stdev: null };
  }
  const sorted = [...numbers].sort((left, right) => left - right);
  const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length;
  const variance = numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length;
  return {
    count: numbers.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    stdev: round(Math.sqrt(variance)),
  };
}

function round(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/*
  Frame arrival intervals expose stutter that a latency percentile cannot. A stream
  can hold a steady 90ms latency and still look wrong if frames arrive in bursts, so
  the gap distribution is reported next to the latency distribution.
*/
function intervalsFrom(samples) {
  const intervals = [];
  for (let index = 1; index < samples.length; index += 1) {
    intervals.push(samples[index].at - samples[index - 1].at);
  }
  return intervals;
}

function formatSummary(label, summary, unit = 'ms') {
  if (!summary.count) return `${label.padEnd(26)} no samples`;
  return [
    label.padEnd(26),
    `n=${String(summary.count).padEnd(6)}`,
    `p50=${String(summary.p50).padEnd(8)}`,
    `p95=${String(summary.p95).padEnd(8)}`,
    `max=${String(summary.max).padEnd(8)}`,
    unit,
  ].join(' ');
}

module.exports = { summarize, percentile, intervalsFrom, formatSummary, round };
