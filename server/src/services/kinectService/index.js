// Kinect Service
// Purpose: Composes Kinect hardware capture and browser socket delivery.
// Scope: Exposes session-readable state while keeping startup side effects in this service folder.
const { loadConfig, registerConfigurationHandler } = require('../../configuration');
const hardware = require('./hardware');
const { registerKinectSocketGateway, kinectEvents } = require('./socketGateway');

const config = loadConfig();
const gateway = registerKinectSocketGateway({
  config,
  hardware,
});

registerConfigurationHandler('kinect', (kinectConfig) => {
  gateway.reconfigure({ kinect: kinectConfig || {} });
});

module.exports = {
  getState: gateway.getState,
  kinectEvents,
};
