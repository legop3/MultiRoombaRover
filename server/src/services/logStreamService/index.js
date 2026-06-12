// log Stream Service
// Purpose: Defines the log Stream Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { v4: uuidv4 } = require('uuid');
const io = require('../../globals/io');
const loggerRoot = require('../../globals/logger');
const logger = loggerRoot.child('logStream');

const MAX_HISTORY = 200;
const LOG_ROOM = 'log:subscribers';
const history = [];

function pushEntry(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function broadcast(entry) {
  /*
    The raw server log stream can produce dozens of socket messages per second.
    Sending those messages only to sockets that joined the diagnostic log room
    keeps ordinary driver pages from spending network, parsing, and session-store
    work on logs they never render.
  */
  io.to(LOG_ROOM).emit('log:entry', entry);
}

function hydrateSocket(socket) {
  if (!socket) return;
  /*
    Hydration is tied to an explicit subscription instead of connection startup.
    This preserves the existing "latest 200 logs" operator view while avoiding
    a large initial payload for pages that do not mount the log panel.
  */
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
  socket.on('log:subscribe', () => {
    /*
      Joining before hydration means a log emitted during the same event loop
      turn cannot be missed between "send history" and "start live stream".
      A duplicate edge entry is less harmful than a hidden gap in diagnostics,
      and entries have stable ids for React keys if that ever occurs.
    */
    socket.join(LOG_ROOM);
    hydrateSocket(socket);
  });

  socket.on('log:unsubscribe', () => {
    /*
      Leaving the room is enough to stop future log entries. The retained server
      history remains global so the next subscriber can still hydrate from the
      same rolling diagnostic buffer.
    */
    socket.leave(LOG_ROOM);
  });
});
