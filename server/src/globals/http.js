// Global HTTP Server
// Purpose: Stores the process-level HTTP server instance created at bootstrap. Scope: Enables services to access server lifecycle state without circular imports.
const http = require('http');
const express = require('express');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./logger').child('mediaMtxProxy');
const { PUBLIC_MEDIA_PREFIX, createMediaMtxProxy } = require('../services/mediaMtxService/proxy');

const app = express();
app.use(morgan('dev'));
/*
  Mount signaling before body parsers so SDP offers and trickle-ICE fragments
  remain untouched streams. Express removes the /video mount prefix while the
  proxy is active, giving MediaMTX its native /<path>/whep or /<path>/whip URL.
*/
app.use(PUBLIC_MEDIA_PREFIX, createMediaMtxProxy({ logger }));
app.use(express.json());
/*
  Docker and the later lifecycle controller need one stable readiness result,
  but they do not need administrator credentials or application details. Load
  the health service only when the route is called so the global HTTP module
  remains safe to initialize before the service graph during bootstrap.
*/
app.get('/health', async (_req, res) => {
  const { getContainerHealth } = require('../services/healthService');
  const health = await getContainerHealth();
  res.status(health.healthy ? 200 : 503).json({
    status: health.healthy ? 'healthy' : 'unhealthy',
    checks: health.checks,
  });
});
app.use(express.static(config.staticDir, { index: false }));

const httpServer = http.createServer(app);

module.exports = { app, httpServer };
