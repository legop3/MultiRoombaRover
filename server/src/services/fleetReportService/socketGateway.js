// Fleet Report Socket Gateway
// Purpose: Exposes read-only, visibility-filtered fleet history to browser clients.
// Scope: Owns query validation and existing private/lockdown access boundaries; it performs no collection or analysis.
const io = require('../../globals/io');
const crypto = require('crypto');
const { isAdmin, isLockdownAdmin } = require('../roleService');

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function normalizeRange(payload = {}) {
  const now = Date.now();
  const until = Number.isFinite(Number(payload.until)) ? Number(payload.until) : now;
  const requestedSince = Number.isFinite(Number(payload.since))
    ? Number(payload.since)
    : until - 24 * 60 * 60 * 1000;
  const since = Math.max(0, Math.max(requestedSince, until - MAX_RANGE_MS));
  return { since, until: Math.max(since + 1, until) };
}

function registerSocketGateway({ roverManager, reportBuilder, storage, collector, logger }) {
  io.on('connection', (socket) => {
    socket.on('fleetReports:get', (payload = {}, cb = () => {}) => {
      try {
        const { since, until } = normalizeRange(payload);
        // getRosterForSocket is the canonical live private-rover visibility
        // resolver. Historical queries use precisely those currently visible
        // rover IDs so fleet totals cannot indirectly disclose a private rover.
        const visibleRoverIds = roverManager.getRosterForSocket(socket).map((rover) => String(rover.id));
        const requestedIds = Array.isArray(payload.roverIds)
          ? payload.roverIds.map(String).filter((id) => visibleRoverIds.includes(id))
          : visibleRoverIds;
        const report = reportBuilder.build({
          since,
          until,
          roverIds: requestedIds,
          includeEvents: payload.includeEvents !== false,
          eventLimit: payload.eventLimit,
        });
        // Lockdown-only events are deliberately removed after query assembly.
        // They are global rather than rover-scoped, so rover filtering alone is
        // insufficient to preserve the pre-existing lockdown privacy boundary.
        if (!isLockdownAdmin(socket)) {
          report.events = report.events.filter((event) => event.visibility !== 'lockdown');
          report.totals.eventCountReturned = report.events.length;
        }
        if (payload.compact === true) {
          // The Activities card needs current totals and findings, not the
          // underlying time series. Removing bulky evidence here keeps the
          // always-visible surface cheap while `/reports` retains full depth.
          report.minutes = [];
          report.events = [];
          report.batterySessions = [];
          report.dailyReportHistory = [];
          report.live = report.live.map((entry) => ({
            roverId: entry.roverId,
            lastAt: entry.lastAt,
            sessionKind: entry.sessionKind,
          }));
        }
        cb({ ok: true, report });
      } catch (err) {
        logger.warn('Fleet report query failed', { socketId: socket.id, error: err.message });
        cb({ error: 'Fleet report query failed' });
      }
    });

    socket.on('fleetReports:replaceBattery', (payload = {}, cb = () => {}) => {
      try {
        if (!isAdmin(socket)) throw new Error('Admin access required');
        const roverId = String(payload.roverId || '').trim();
        if (!roverId || !roverManager.rovers.has(roverId)) throw new Error('Known online rover required');
        const ratedCapacityMah = Number(payload.ratedCapacityMah);
        if (!Number.isFinite(ratedCapacityMah) || ratedCapacityMah <= 0 || ratedCapacityMah > 65535) {
          throw new Error('Rated capacity must be between 1 and 65535 mAh');
        }
        const installedAt = Number.isFinite(Number(payload.installedAt)) ? Number(payload.installedAt) : Date.now();
        const entry = storage.replaceBattery({
          roverId,
          batteryKey: `battery:${roverId}:${installedAt}:${crypto.randomUUID().slice(0, 8)}`,
          chemistry: String(payload.chemistry || '').trim() || null,
          ratedCapacityMah: Math.round(ratedCapacityMah),
          installedAt,
          notes: String(payload.notes || '').trim() || null,
        });
        if (!entry) throw new Error('Battery registry write failed');
        collector.refreshBatteryIdentity(roverId);
        collector.collectEvent({
          source: 'fleetReportService',
          type: 'battery.replaced',
          payload: { roverId, battery: entry },
        });
        cb({ ok: true, battery: entry });
      } catch (err) {
        logger.warn('Fleet battery replacement rejected', { socketId: socket.id, error: err.message });
        cb({ error: err.message });
      }
    });
  });
}

module.exports = {
  registerSocketGateway,
};
