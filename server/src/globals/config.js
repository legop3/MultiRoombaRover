// Global Config
// Purpose: Stores process-level mutable configuration shared across services. Scope: Provides read/write access to runtime config loaded at server startup.
const path = require('path');

module.exports = {
  port: process.env.PORT || 8080,
  staticDir: path.join(__dirname, '..', '..', 'public'),
};
