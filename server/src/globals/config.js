const path = require('path');

module.exports = {
  port: process.env.PORT || 8080,
  staticDir: path.join(__dirname, '..', '..', 'public'),
};
