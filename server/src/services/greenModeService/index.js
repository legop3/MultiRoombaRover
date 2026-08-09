// Green Mode Service
// Purpose: Owns the temporary server-wide green visual mode and its tiny light workflow.
// Scope: Composes existing Home Assistant operations; it does not add policy to that service.
const EventEmitter = require('events');
const logger = require('../../globals/logger').child('greenModeService');
const { sendAlert } = require('../alertService');
const homeAssistantService = require('../homeAssistantService');
const { modeEvents } = require('../modeManager');

const GREEN_MODE_COLOR = '#00ff00';
const greenModeEvents = new EventEmitter();
let enabled = false;

function isEnabled() {
  return enabled;
}

async function setEnabled(nextValue, options = {}) {
  const next = Boolean(nextValue);
  if (enabled === next) return enabled;

  if (next) {
    /*
      Lock first because the existing locked-on transition sets lights white.
      Recoloring RGB lights afterward leaves them green while retaining the
      established room-control lock, idle protection, and laser safety rules.
    */
    await homeAssistantService.setLightsLockedOn(true, {
      source: String(options?.source || 'greenMode:enable'),
    });

    const entities = homeAssistantService.getState()?.entities || [];
    /*
      RGB-capable lights become the requested solid green. Every other
      configured room control, including white-only bulbs and switches, is
      explicitly turned off so the physical room has one unambiguous effect.
      These remain generic Home Assistant calls; that service does not know
      that the operations belong to green mode.
    */
    const results = await Promise.allSettled(
      entities.map((entity) => (
        entity?.supportsColor
          ? homeAssistantService.setLightColor(entity.id, GREEN_MODE_COLOR)
          : homeAssistantService.setEntityState(entity.id, 'off', {
            source: 'greenMode:non-rgb-off',
          })
      )),
    );
    const failures = results
      .map((result, index) => ({ result, entityId: entities[index].id }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, entityId }) => ({ entityId, error: result.reason?.message || 'unknown error' }));

    if (failures.length) {
      logger.warn('Some room controls failed to enter green mode', { failures });
    }
  } else {
    // Disabling the visual mode simply releases the lock it created. Bulb
    // colors remain untouched, matching the existing one-shot light behavior.
    await homeAssistantService.setLightsLockedOn(false, {
      source: String(options?.source || 'greenMode:disable'),
    });
  }

  enabled = next;
  logger.info('Green mode changed', {
    enabled,
    source: options?.source || 'unknown',
  });
  // Emit one shared server alert for every completed transition. Automatic
  // access-mode shutdown uses this same function, so clients also receive the
  // inactive notice when green mode ends without an explicit chat command.
  sendAlert({
    color: GREEN_MODE_COLOR,
    title: 'Green mode',
    message: enabled ? 'Green mode is active.' : 'Green mode is inactive.',
  });
  greenModeEvents.emit('change', enabled);
  return enabled;
}

modeEvents.on('change', () => {
  if (!enabled) return;
  setEnabled(false, { source: 'modeGateReset' }).catch((err) => {
    logger.warn('Failed to disable green mode on access-mode change', err.message);
  });
});

module.exports = {
  isEnabled,
  setEnabled,
  greenModeEvents,
};
