// Rover Help Service
// Purpose: Publishes sustained 600-series Roomba trouble as roster and alert state.
// Scope: Integrates the pure monitor with roverManager, browser alerts, and the event bus.
const roverManager = require('../roverManager');
const { sendAlert } = require('../alertService');
const { publishEvent } = require('../eventBus');
const { REASON_LABELS, createRoverHelpMonitor } = require('./monitor');

const HELP_ALERT_COLOR = '#ef4444';

const monitor = createRoverHelpMonitor({
  onChange({ roverId, needsHelp, addedReason, reasons }) {
    const record = roverManager.rovers.get(String(roverId));
    if (!record) return;
    const wasNeedingHelp = Boolean(record.needsHelp);
    roverManager.setNeedsHelp(roverId, needsHelp);

    if (!wasNeedingHelp && needsHelp) {
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
  if (action === 'removed') monitor.removeRover(roverId);
});

module.exports = { monitor };
