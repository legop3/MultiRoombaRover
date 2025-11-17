require('./src/globals/logger');
require('./src/globals/config');
require('./src/globals/http');
require('./src/globals/io');
require('./src/globals/ws');

require('./src/helpers/sensorDecoder');

require('./src/services/alertService');
require('./src/services/authService');
require('./src/services/modeManager');
require('./src/services/lockdownGuard');
require('./src/services/roverManager');
require('./src/services/commandService');
require('./src/services/roverConnectionService');
require('./src/services/assignmentService');
require('./src/services/videoSessions');
require('./src/services/videoAuthService');
require('./src/services/videoSocketService');
require('./src/services/logStreamService');
require('./src/services/sessionService');
require('./src/services/httpServer');
