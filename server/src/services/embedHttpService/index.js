// embed Http Service
// Purpose: Defines the embed Http Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { app } = require('../../globals/http');
const { renderIndexHtml, renderOgImage } = require('../embedService');

app.get(['/', '/spectate', '/mini', '/display'], async (req, res) => {
  try {
    const html = await renderIndexHtml(req);
    res.type('html').send(html);
  } catch (err) {
    res.status(500).send('Failed to render page');
  }
});

app.get('/og/preview.png', async (req, res) => {
  try {
    const buffer = await renderOgImage();
    res.set('Cache-Control', 'public, max-age=60');
    res.type('png').send(buffer);
  } catch (err) {
    res.status(500).send('Failed to render embed image');
  }
});
