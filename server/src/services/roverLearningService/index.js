// The only resident part while disabled is this configuration lifecycle bridge.
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const logger = require('../../globals/logger').child('roverLearning');

let runtime = null;
let transitions = Promise.resolve();
let shuttingDown = false;

function apply(config) {
  const transition = transitions.then(async () => {
    if (runtime) {
      const previous = runtime;
      runtime = null;
      await previous.stop();
    }
    if (!config?.enabled || shuttingDown) return;
    const { createRuntime } = require('./runtime');
    const next = createRuntime({ config, logger });
    try {
      await next.start();
      runtime = next;
    } catch (error) {
      await next.stop();
      throw error;
    }
  });
  transitions = transition.catch(() => undefined);
  return transition;
}

registerConfigurationHandler('roverLearning', apply);
apply(loadConfig().roverLearning).catch((error) => {
  logger.error('Unable to start rover learning recording', { error: error.message });
});

// Signal handlers are installed by the enabled runtime, not by this bridge.
module.exports = {
  stop: () => { shuttingDown = true; return apply({ enabled: false }); },
};
