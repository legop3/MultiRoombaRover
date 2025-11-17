const { v4: uuidv4 } = require('uuid');
const io = require('../globals/io');
const loggerRoot = require('../globals/logger');
const logger = loggerRoot.child('logStream');

const MAX_HISTORY = 200;
const history = [];

function pushEntry(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function broadcast(entry) {
  io.emit('log:entry', entry);
}

function hydrateSocket(socket) {
  if (!socket) return;
  socket.emit('log:init', history);
}

loggerRoot.registerSink(({ level, label, message, timestamp }) => {
  const entry = {
    id: uuidv4(),
    level,
    label,
    message,
    timestamp,
  };
  pushEntry(entry);
  broadcast(entry);
});

io.on('connection', (socket) => {
  logger.info('Hydrating log history for', socket.id);
  hydrateSocket(socket);
});
