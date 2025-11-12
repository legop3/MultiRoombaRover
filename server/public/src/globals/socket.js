registerModule('globals/socket', (require, exports) => {
  const socket = io();
  exports.socket = socket;
});
