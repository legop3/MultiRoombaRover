// button Box Service HTTP route
// Purpose: Registers button-box press endpoint and request validation against local-network policy.
// Scope: Keeps runtime behavior unchanged while isolating transport/validation from domain logic.
const express = require('express');

function registerButtonBoxRoute(deps) {
  const {
    app,
    logger,
    buttonCount,
    getRequestIp,
    normalizeIp,
    isLocalNetwork,
    applyPress,
  } = deps;

  function parseButtonId(body) {
    if (typeof body !== 'string') return null;
    const value = Number.parseInt(body.trim(), 10);
    if (Number.isFinite(value)) return value;
    return null;
  }

  function denyIfNotLocal(req, res) {
    const ip = normalizeIp(getRequestIp(req));
    if (isLocalNetwork(ip)) {
      return false;
    }
    logger.warn('Rejected non-local button press request', { ip: ip || null });
    res.status(403).json({ error: 'Button presses must originate from local network' });
    return true;
  }

  app.post('/buttonbox/press', express.text({ type: 'text/plain' }), async (req, res) => {
    if (denyIfNotLocal(req, res)) return;
    const buttonId = parseButtonId(req.body);
    if (!Number.isFinite(buttonId) || buttonId < 1 || buttonId > buttonCount) {
      res.status(400).json({ error: 'button must be 1-4' });
      return;
    }
    try {
      const button = await applyPress(buttonId);
      res.json({ success: true, button });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Button processing failed' });
    }
  });
}

module.exports = {
  registerButtonBoxRoute,
};
