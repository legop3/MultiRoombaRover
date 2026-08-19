// embed Http Service
// Purpose: Defines the embed Http Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const { app } = require('../../globals/http');
const { renderIndexHtml, renderOgImage, renderWebManifest } = require('../embedService');

/*
  Every client-side BrowserRouter entry point must also be an explicit HTTP
  entry point. Keeping this list aligned with webui/src/main.jsx lets direct
  loads and browser refreshes receive the same rendered index document as
  in-app navigation. The retired desktop composition is intentionally exposed
  at /old; the removed /newdrive route is intentionally absent.
*/
app.get(['/', '/old', '/spectate', '/mini', '/display', '/scanner', '/database', '/ptz', '/reports'], async (req, res) => {
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

app.get('/manifest.webmanifest', (req, res) => {
  /*
    The manifest varies with server configuration, so it is served by the
    application rather than copied into Vite's static output. Revalidation
    lets browsers pick up branding changes after the server is restarted.
  */
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(renderWebManifest());
});
