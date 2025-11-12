const { httpServer } = require('../globals/http');
const config = require('../globals/config');
const logger = require('../globals/logger');

httpServer.listen(config.port, () => {
  logger.info(`Server listening on :${config.port}`);
});
