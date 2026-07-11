// Video Auth Service Module
// Purpose: Composes MediaMTX stream parsing, authorization policy, and HTTP route registration.
// Scope: Exposes the video-auth service boundary while keeping runtime behavior unchanged.
const { app } = require('../../globals/http');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('videoAuth');
const videoSessions = require('../videoSessions');
const { getMode, MODES } = require('../modeManager');
const { isAdmin, isLockdownAdmin, getRole } = require('../roleService');
const { isVerified } = require('../verificationService');
const turnService = require('../turnService');
const roverManager = require('../roverManager');
const ptzCameraService = require('../ptzCameraService');
const { getRequestIp, getSocketIp, isLocalNetwork } = require('../../helpers/ipResolver');
const { logAdminEvent } = require('../adminLogService');

const { extractStreamInfoFromBody } = require('./streamParsing');
const { createVideoAuthPolicy } = require('./policy');
const { registerVideoAuthRoute } = require('./httpRoute');

const { canAccessStream } = createVideoAuthPolicy({
  getMode,
  MODES,
  isAdmin,
  isLockdownAdmin,
  getRole,
  isVerified,
  turnService,
  roverManager,
  ptzCameraService,
  getSocketIp,
  isLocalNetwork,
});

registerVideoAuthRoute({
  app,
  io,
  logger,
  videoSessions,
  getRequestIp,
  logAdminEvent,
  extractStreamInfoFromBody,
  canAccessStream,
});

module.exports = {};
