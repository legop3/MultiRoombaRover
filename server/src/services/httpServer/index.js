// http Server
// Purpose: Defines the http Server module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { httpServer } = require('../../globals/http');
const config = require('../../globals/config');
const logger = require('../../globals/logger').child('httpServer');

httpServer.listen(config.port, () => {
  logger.info(`Server listening on :${config.port}`);
});
