// embed Http Service
// Purpose: Defines the embed Http Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { app } = require('../../globals/http');
const { renderIndexHtml, renderOgImage } = require('../embedService');

/*
  Every client-side BrowserRouter entry point must also be an explicit HTTP
  entry point. Including /ptz here lets direct loads and browser refreshes
  receive the same rendered index document as navigation from the driver page.
*/
app.get(['/', '/spectate', '/mini', '/display', '/scanner', '/database', '/ptz', '/reports'], async (req, res) => {
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
