// Latency Harness Page Server
// Purpose: Serves the probe page from a real HTTP origin.
// Scope: Static hosting only; no proxying, so the WHEP request path stays identical to production.

const http = require('http');

/*
  The probe cannot run from setContent or about:blank. Both give the page an opaque
  origin, which sends `Origin: null` on the WHEP preflight and gets the fetch
  rejected before any media flows.

  Serving from 127.0.0.1 also matches how the real web UI reaches MediaMTX: a page
  on one HTTP origin POSTing cross-origin to the media server. That means the
  harness exercises the same CORS and signalling path production does, rather than
  a shortcut that could hide a failure mode.
*/
function startPageServer({ host = '127.0.0.1', port = 0 } = {}) {
  const server = http.createServer((request, response) => {
    if (request.url === '/' || request.url.startsWith('/?')) {
      const body = '<!doctype html><meta charset="utf-8"><title>latency probe</title><body></body>';
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      resolve({
        origin: `http://${host}:${actualPort}`,
        port: actualPort,
        async stop() {
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

module.exports = { startPageServer };
