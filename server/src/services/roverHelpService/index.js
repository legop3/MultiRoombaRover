// Rover Help Service
// Purpose: Publishes sustained 600-series Roomba trouble as roster and alert state.
// Scope: Integrates the pure monitor with roverManager, browser alerts, and the event bus.
const roverManager = require('../roverManager');
const { sendAlert } = require('../alertService');
const { publishEvent } = require('../eventBus');
const { REASON_LABELS, createRoverHelpMonitor } = require('./monitor');
const { createHelpHornNotifier } = require('./hornNotifier');

const HELP_ALERT_COLOR = '#ef4444';

const hornNotifier = createHelpHornNotifier({
  getRover: (roverId) => roverManager.rovers.get(String(roverId)),
  // commandService imports roverManager, so resolving it only when a chirp is
  // actually issued avoids turning server startup order into a circular module
  // dependency while retaining the established command transport.
  issueCommand: (roverId, payload) => require('../commandService').issueCommand(roverId, payload),
  logger: require('../../globals/logger').child('roverHelpService'),
});

const monitor = createRoverHelpMonitor({
  onChange({ roverId, needsHelp, addedReason, reasons }) {
    const record = roverManager.rovers.get(String(roverId));
    if (!record) return;
    const wasNeedingHelp = Boolean(record.needsHelp);
    roverManager.setNeedsHelp(roverId, needsHelp);

    if (!wasNeedingHelp && needsHelp) {
      hornNotifier.start(roverId);
      const reason = REASON_LABELS[addedReason] || 'a sustained rover fault was detected';
      sendAlert({
        color: HELP_ALERT_COLOR,
        title: 'Rover Needs Help',
        message: `${record.meta?.name || roverId}: ${reason}.`,
      });
      // Discord owns presentation of this event. The UI intentionally receives
      // only the roster boolean, keeping every HELP overlay free of reason text.
      publishEvent({
        source: 'roverHelpService',
        type: 'rover.helpNeeded',
        payload: { roverId, roverName: record.meta?.name || roverId, reason, reasons },
      });
    } else if (wasNeedingHelp && !needsHelp) {
      hornNotifier.stop(roverId);
      publishEvent({
        source: 'roverHelpService',
        type: 'rover.helpCleared',
        payload: { roverId, roverName: record.meta?.name || roverId },
      });
    }
  },
});

roverManager.managerEvents.on('sensor', ({ roverId, sensors }) => {
  monitor.handleSensor(roverId, sensors);
});

roverManager.managerEvents.on('dockGuard', (event) => {
  monitor.handleDockGuard(event);
});

roverManager.managerEvents.on('rover', ({ roverId, action }) => {
  // A reconnect gets a fresh record and fresh persistence timers; stale sensor
  // history from a disconnected chassis must never immediately restore HELP.
  if (action === 'removed') {
    hornNotifier.stop(roverId);
    monitor.removeRover(roverId);
  }
});

module.exports = { hornNotifier, monitor };
