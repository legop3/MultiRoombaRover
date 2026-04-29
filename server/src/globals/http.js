// Global HTTP Server
// Purpose: Stores the process-level HTTP server instance created at bootstrap. Scope: Enables services to access server lifecycle state without circular imports.
const http = require('http');
const express = require('express');
const morgan = require('morgan');
const config = require('./config');

const app = express();
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(config.staticDir, { index: false }));

const httpServer = http.createServer(app);

module.exports = { app, httpServer };
