// Rover Snapshot Service
// Purpose: Composes rover snapshot polling and snapshot socket delivery in one folderized service.
// Scope: Preserves existing rover snapshot events/state exports and startup side effects.
const roverManager = require('../roverManager');
const { createRoverSnapshotPoller } = require('./poller');
const { registerRoverSnapshotSocketGateway } = require('./socketGateway');

const poller = createRoverSnapshotPoller({ roverManager });
poller.startAll();

registerRoverSnapshotSocketGateway({
  roverManager,
  roverSnapshotEvents: poller.roverSnapshotEvents,
  getRoverSnapshotState: poller.getRoverSnapshotState,
});

module.exports = {
  roverSnapshotEvents: poller.roverSnapshotEvents,
  getRoverSnapshotState: poller.getRoverSnapshotState,
};
