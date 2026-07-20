// Fleet Report Service
// Purpose: Composes optional passive collection, storage, analysis, retention, and read-only transport.
// Scope: This is the sole feature boundary; disabled installations register no collectors, timers, database, or sockets.
const { loadConfig } = require('../../helpers/configLoader');
const { isFeatureEnabled } = require('../../helpers/features');
const logger = require('../../globals/logger').child('fleetReportService');

if (!isFeatureEnabled('fleetReports')) {
  module.exports = {
    enabled: false,
    getDailyReport: () => null,
  };
} else {
  const { subscribeAll } = require('../eventBus');
  const roverManager = require('../roverManager');
  const { commandEvents } = require('../commandService');
  const { odometerEvents } = require('../odometerService');
  const { createStorage } = require('./storage');
  const { createCollector } = require('./collector');
  const { createReportBuilder } = require('./reportBuilder');
  const { registerSocketGateway } = require('./socketGateway');

  const config = loadConfig().fleetReports || {};
  const batteryConfig = config.battery || {};
  const retentionConfig = config.retention || {};
  const maximumIntegrationGapMs = Math.max(
    250,
    (Number(batteryConfig.maximumIntegrationGapSeconds) || 5) * 1000,
  );
  const minimumCapacityTestDepthPercent = Math.max(
    10,
    Math.min(100, Number(batteryConfig.minimumCapacityTestDepthPercent) || 60),
  );
  const batteryEnabled = batteryConfig.enabled !== false;
  const storage = createStorage({ logger });
  const collector = createCollector({
    storage,
    logger,
    maximumIntegrationGapMs,
    minimumCapacityTestDepthPercent,
  });
  const reportBuilder = createReportBuilder({ storage, collector, roverManager });

  storage.open();
  const unsubscribeEvents = subscribeAll(collector.collectEvent);
  if (batteryEnabled) roverManager.managerEvents.on('sensor', collector.collectSensor);
  commandEvents.on('observation', collector.collectCommand);
  odometerEvents.on('update', collector.collectOdometer);
  const managerEventKinds = ['rover', 'hostStats', 'driver', 'switch', 'lock', 'private', 'privateSafety'];
  const managerEventHandlers = new Map(managerEventKinds.map((kind) => {
    const handler = (event) => collector.collectManagerEvent(kind, event);
    roverManager.managerEvents.on(kind, handler);
    return [kind, handler];
  }));
  registerSocketGateway({ roverManager, reportBuilder, storage, collector, logger });

  // Periodic upserts bound data-loss on an unclean shutdown while still
  // avoiding writes at the 20 Hz sensor-frame rate.
  const flushTimer = setInterval(() => collector.flushMinutes(), 30 * 1000);
  flushTimer.unref?.();

  function retentionDays(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function pruneNow() {
    const now = Date.now();
    const detailedDays = retentionDays(retentionConfig.detailedDays, 0);
    const minuteDays = retentionDays(retentionConfig.minuteSamplesDays, 0);
    storage.prune({
      detailedBefore: detailedDays === 0 ? 0 : now - detailedDays * 86400000,
      minuteBefore: minuteDays === 0 ? 0 : now - minuteDays * 86400000,
    });
  }
  pruneNow();
  const retentionTimer = setInterval(pruneNow, 6 * 60 * 60 * 1000);
  retentionTimer.unref?.();

  function getDailyReport({ since, until, roverIds } = {}) {
    const end = Number(until) || Date.now();
    return reportBuilder.build({
      since: Number(since) || end - 24 * 60 * 60 * 1000,
      until: end,
      roverIds: Array.isArray(roverIds) ? roverIds : undefined,
      includeEvents: true,
      eventLimit: 1000,
    });
  }

  logger.info('Fleet reporting enabled', {
    databaseAvailable: storage.getDiagnostics().available,
    maximumIntegrationGapMs,
    minimumCapacityTestDepthPercent,
    batteryEnabled,
  });

  module.exports = {
    enabled: true,
    getDailyReport,
    collector,
    storage,
    reportBuilder,
    // Exposed for controlled tests and graceful future shutdown wiring. Normal
    // runtime leaves subscriptions active for the lifetime of the server.
    stop() {
      unsubscribeEvents();
      if (batteryEnabled) roverManager.managerEvents.off('sensor', collector.collectSensor);
      commandEvents.off('observation', collector.collectCommand);
      odometerEvents.off('update', collector.collectOdometer);
      managerEventHandlers.forEach((handler, kind) => roverManager.managerEvents.off(kind, handler));
      clearInterval(flushTimer);
      clearInterval(retentionTimer);
      collector.flushMinutes();
    },
  };
}
