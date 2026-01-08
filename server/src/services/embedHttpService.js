const { app } = require('../globals/http');
const { renderIndexHtml, renderOgImage } = require('./embedService');

app.get(['/', '/spectate', '/mini'], async (req, res) => {
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
