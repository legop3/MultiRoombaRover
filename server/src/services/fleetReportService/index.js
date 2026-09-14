// Fleet Report Service
// Purpose: Owns the replaceable collection/report runtime and its stable browser API.
// Scope: Applies the complete fleetReports section without restarting the Node process.
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const logger = require('../../globals/logger').child('fleetReportService');
const { subscribeAll } = require('../eventBus');
const roverManager = require('../roverManager');
const { commandEvents } = require('../commandService');
const { odometerEvents } = require('../odometerService');
const { createStorage } = require('./storage');
const { createCollector } = require('./collector');
const { createReportBuilder } = require('./reportBuilder');
const { registerSocketGateway } = require('./socketGateway');

let runtime = null;
let storage = null;

function retentionDays(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function stopRuntime() {
  if (!runtime) return;
  runtime.unsubscribeEvents();
  if (runtime.batteryEnabled) roverManager.managerEvents.off('sensor', runtime.collector.collectSensor);
  commandEvents.off('observation', runtime.collector.collectCommand);
  odometerEvents.off('update', runtime.collector.collectOdometer);
  runtime.managerEventHandlers.forEach((handler, kind) => roverManager.managerEvents.off(kind, handler));
  clearInterval(runtime.flushTimer);
  clearInterval(runtime.retentionTimer);
  runtime.collector.flushMinutes();
  runtime = null;
}

function startRuntime(config = {}) {
  stopRuntime();
  if (!config.enabled) {
    logger.info('Fleet reporting disabled by config');
    return;
  }

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
  const batteryEnabled = Boolean(batteryConfig.enabled);

  // Keep one SQLite connection for the process lifetime. Configuration reloads
  // replace collectors and timers, not the durable database they share.
  if (!storage) {
    storage = createStorage({ logger });
    storage.open();
  }
  const collector = createCollector({
    storage,
    logger,
    maximumIntegrationGapMs,
    minimumCapacityTestDepthPercent,
  });
  const reportBuilder = createReportBuilder({ storage, collector, roverManager });
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

  const flushTimer = setInterval(() => collector.flushMinutes(), 30 * 1000);
  flushTimer.unref?.();
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

  runtime = {
    batteryEnabled,
    storage,
    collector,
    reportBuilder,
    unsubscribeEvents,
    managerEventHandlers,
    flushTimer,
    retentionTimer,
  };
  logger.info('Fleet reporting enabled', {
    databaseAvailable: storage.getDiagnostics().available,
    maximumIntegrationGapMs,
    minimumCapacityTestDepthPercent,
    batteryEnabled,
  });
}

registerSocketGateway({ roverManager, getRuntime: () => runtime, logger });
startRuntime(loadConfig().fleetReports || {});
registerConfigurationHandler('fleetReports', startRuntime);

module.exports = {
  get enabled() {
    return Boolean(runtime);
  },
  getDailyReport({ since, until, roverIds } = {}) {
    if (!runtime) return null;
    const end = Number(until) || Date.now();
    return runtime.reportBuilder.build({
      since: Number(since) || end - 24 * 60 * 60 * 1000,
      until: end,
      roverIds: Array.isArray(roverIds) ? roverIds : undefined,
      includeEvents: false,
    });
  },
  get collector() {
    return runtime?.collector || null;
  },
  get storage() {
    return runtime?.storage || storage;
  },
  get reportBuilder() {
    return runtime?.reportBuilder || null;
  },
  stop: stopRuntime,
};
