// Container Lifecycle Client
// Purpose: Sends fixed lifecycle requests from the application to the private controller socket.
// Scope: This client cannot select images, containers, or Docker arguments; the controller owns those constants.
const http = require('http');

const LIFECYCLE_SOCKET_PATH = process.env.MULTIROVER_LIFECYCLE_SOCKET || '/run/multirover/lifecycle.sock';
const REQUEST_TIMEOUT_MS = 5000;

function requestLifecycleController({ method = 'GET', path }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: LIFECYCLE_SOCKET_PATH,
      method,
      path,
      headers: { Accept: 'application/json' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        // Controller responses contain only a small status document. Keeping a
        // hard bound prevents a broken peer from growing application memory.
        body += chunk;
        if (body.length > 64 * 1024) request.destroy(new Error('Lifecycle controller response is too large.'));
      });
      response.on('end', () => {
        let parsed;
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          reject(new Error('Lifecycle controller returned an invalid response.'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(parsed.error || 'Lifecycle controller request failed.'));
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Lifecycle controller did not respond.')));
    request.on('error', reject);
    request.end();
  });
}

async function getLifecycleStatus() {
  try {
    return await requestLifecycleController({ path: '/status' });
  } catch (error) {
    /*
      The legacy development/server installation deliberately has no lifecycle
      controller. Report that as an unavailable capability so the existing
      in-process restart remains usable instead of turning absence into a noisy
      server error.
    */
    return {
      available: false,
      state: 'unavailable',
      message: error.message,
      operation: null,
      updateAvailable: null,
    };
  }
}

module.exports = {
  checkForUpdate: () => requestLifecycleController({ method: 'POST', path: '/check' }),
  getLifecycleStatus,
  restartApplication: () => requestLifecycleController({ method: 'POST', path: '/restart' }),
  updateApplication: () => requestLifecycleController({ method: 'POST', path: '/update' }),
};
