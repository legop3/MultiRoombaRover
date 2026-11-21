// Roomba encoder speed only: no distance totals, disk state, or subscriptions.
const samples = new Map();
const mmPerCount = Math.PI * 72 / 508.8;
function processSensorFrame(id, sensors) {
  const left = sensors?.encoderCountsLeft;
  const right = sensors?.encoderCountsRight;
  const empty = { left: null, right: null, center: null };
  if (!Number.isInteger(left) || !Number.isInteger(right)) { samples.delete(id); return empty; }
  const now = Date.now();
  const previous = samples.get(id);
  samples.set(id, { left, right, time: now });
  if (!previous || now - previous.time > 1500) return empty;
  const dt = (now - previous.time) / 1000;
  if (dt <= 0) return empty;
  // Encoders wrap at 16 bits. Reject implausible jumps after a reset.
  const delta = (a, b) => ((a - b + 98304) % 65536 - 32768) * mmPerCount;
  const l = delta(left, previous.left), r = delta(right, previous.right);
  if (Math.max(Math.abs(l), Math.abs(r)) > Math.max(250, dt * 1200)) return empty;
  return { left: Math.round(l/dt), right: Math.round(r/dt), center: Math.round((l+r)/(2*dt)) };
}
module.exports = { processSensorFrame, clear: (id) => samples.delete(id) };
