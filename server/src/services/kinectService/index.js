// Kinect Service
// Purpose: Composes Kinect hardware capture and browser socket delivery.
// Scope: Exposes session-readable state while keeping startup side effects in this service folder.
const { loadConfig } = require('../../helpers/configLoader');
const hardware = require('./hardware');
const { registerKinectSocketGateway, kinectEvents } = require('./socketGateway');

const config = loadConfig();
const gateway = registerKinectSocketGateway({
  config,
  hardware,
});

module.exports = {
  getState: gateway.getState,
  kinectEvents,
};
