// Restricted Container Lifecycle Controller
// Purpose: Pulls and replaces only the fixed MultiRover application container through Docker's local API.
// Scope: Runs as the private lifecycle Compose service; it exposes no TCP listener and accepts no caller-selected targets.
const fs = require('fs');
const path = require('path');
const http = require('http');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const TARGET_CONTAINER_NAME = 'multirover';
const TARGET_IMAGE = process.env.MULTIROVER_TARGET_IMAGE || 'ghcr.io/legop3/multiroombarover:latest';
const SOCKET_PATH = process.env.MULTIROVER_LIFECYCLE_SOCKET || '/run/multirover/lifecycle.sock';
// Status belongs beside the controller's private socket instead of in the
// application's data volume. The controller runs as root for Docker access;
// keeping it out of /data prevents it from creating directories that the
// non-root application cannot later use for replay and audio runtime work.
const STATUS_PATH = process.env.MULTIROVER_LIFECYCLE_STATUS || '/run/multirover/status.json';
const HEALTH_TIMEOUT_MS = 2 * 60 * 1000;
const HEALTH_POLL_MS = 1000;

let operationRunning = false;
let status = readStatus();

function readStatus() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
    // A controller replacement cannot resume an in-flight Docker operation.
    // Preserve its history but make the interrupted result explicit.
    if (saved.state === 'running') {
      return {
        ...saved,
        state: 'failed',
        message: 'The lifecycle controller restarted before the operation completed.',
        completedAt: Date.now(),
      };
    }
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(`Unable to read lifecycle status: ${error.message}\n`);
    return {
      state: 'idle',
      operation: null,
      message: 'No lifecycle operation has run yet.',
      startedAt: null,
      completedAt: null,
      runningImage: null,
      availableImage: null,
      updateAvailable: null,
      rollback: null,
    };
  }
}

function writeStatus(patch) {
  status = { ...status, ...patch };
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  const temporaryPath = `${STATUS_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, STATUS_PATH);
  return status;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function inspectTargetContainer() {
  return docker.getContainer(TARGET_CONTAINER_NAME).inspect();
}

async function inspectLocalTargetImage() {
  try {
    return await docker.getImage(TARGET_IMAGE).inspect();
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

async function pullTargetImage() {
  const stream = await new Promise((resolve, reject) => {
    docker.pull(TARGET_IMAGE, (error, pullStream) => (error ? reject(error) : resolve(pullStream)));
  });
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()));
  });
  const image = await inspectLocalTargetImage();
  if (!image) throw new Error('Docker finished pulling but the target image is unavailable.');
  return image;
}

function environmentMap(values = []) {
  const result = new Map();
  values.forEach((entry) => {
    const separator = String(entry).indexOf('=');
    const key = separator >= 0 ? entry.slice(0, separator) : entry;
    result.set(key, String(entry));
  });
  return result;
}

function mergeEnvironment({ current = [], previousDefaults = [], nextDefaults = [] }) {
  const previous = environmentMap(previousDefaults);
  const overrides = current.filter((entry) => previous.get(String(entry).split('=', 1)[0]) !== entry);
  const merged = environmentMap(nextDefaults);
  overrides.forEach((entry) => merged.set(String(entry).split('=', 1)[0], entry));
  return [...merged.values()];
}

async function buildReplacementOptions({ current, imageReference }) {
  const [previousImage, nextImage] = await Promise.all([
    docker.getImage(current.Image).inspect(),
    docker.getImage(imageReference).inspect(),
  ]);
  const imageConfig = nextImage.Config || {};

  /*
    Image-owned defaults come from the replacement image so updates can change
    their command, health check, or runtime environment. Only environment
    values that Compose overrode on the running container survive. HostConfig
    is copied intact because it contains the named volume, host networking,
    device access, capability, security, and restart-policy contract.
  */
  return {
    name: TARGET_CONTAINER_NAME,
    Image: imageReference,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: mergeEnvironment({
      current: current.Config?.Env,
      previousDefaults: previousImage.Config?.Env,
      nextDefaults: imageConfig.Env,
    }),
    Cmd: imageConfig.Cmd,
    Entrypoint: imageConfig.Entrypoint,
    WorkingDir: imageConfig.WorkingDir,
    User: imageConfig.User,
    ExposedPorts: imageConfig.ExposedPorts,
    Volumes: imageConfig.Volumes,
    Healthcheck: imageConfig.Healthcheck,
    StopSignal: imageConfig.StopSignal,
    StopTimeout: imageConfig.StopTimeout,
    Labels: { ...(imageConfig.Labels || {}), ...(current.Config?.Labels || {}) },
    HostConfig: current.HostConfig,
  };
}

async function removeContainerIfPresent() {
  const container = docker.getContainer(TARGET_CONTAINER_NAME);
  try {
    const current = await container.inspect();
    if (current.State?.Running) {
      try {
        await container.stop({ t: 20 });
      } catch (error) {
        if (error.statusCode !== 304) throw error;
      }
    }
    await container.remove();
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
}

async function replaceContainer({ template, imageReference }) {
  const options = await buildReplacementOptions({ current: template, imageReference });
  await removeContainerIfPresent();
  const replacement = await docker.createContainer(options);
  await replacement.start();
  return replacement;
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await inspectTargetContainer();
    const health = current.State?.Health?.Status;
    if (current.State?.Running && health === 'healthy') return current;
    if (health === 'unhealthy') throw new Error('The replacement container failed its health check.');
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error('The replacement container did not become healthy in time.');
}

async function refreshImageStatus() {
  const [container, image] = await Promise.all([
    inspectTargetContainer(),
    inspectLocalTargetImage(),
  ]);
  return writeStatus({
    runningImage: container.Image,
    availableImage: image?.Id || null,
    updateAvailable: image ? container.Image !== image.Id : null,
  });
}

async function runCheck() {
  writeStatus({ message: `Pulling ${TARGET_IMAGE}…` });
  await pullTargetImage();
  const current = await refreshImageStatus();
  return current.updateAvailable ? 'An application update is available.' : 'The application is current.';
}

async function runRestart() {
  writeStatus({ message: 'Restarting the application container…' });
  await docker.getContainer(TARGET_CONTAINER_NAME).restart({ t: 20 });
  await waitForHealthyContainer();
  await refreshImageStatus();
  return 'The application container restarted successfully.';
}

async function runUpdate() {
  writeStatus({ message: `Pulling ${TARGET_IMAGE}…`, rollback: null });
  const targetImage = await pullTargetImage();
  const previousContainer = await inspectTargetContainer();
  const previousImage = previousContainer.Image;
  let replacementStarted = false;

  try {
    writeStatus({
      message: 'Replacing the application container…',
      runningImage: previousImage,
      availableImage: targetImage.Id,
      updateAvailable: previousImage !== targetImage.Id,
    });
    replacementStarted = true;
    await replaceContainer({ template: previousContainer, imageReference: TARGET_IMAGE });
    writeStatus({ message: 'Waiting for the updated application to become healthy…' });
    const healthy = await waitForHealthyContainer();
    writeStatus({
      runningImage: healthy.Image,
      availableImage: targetImage.Id,
      updateAvailable: false,
    });
    return previousImage === targetImage.Id
      ? 'The current application image was restarted successfully.'
      : 'The application was updated successfully.';
  } catch (error) {
    if (!replacementStarted) throw error;
    writeStatus({ message: 'The update failed; restoring the previous application image…' });
    try {
      await replaceContainer({ template: previousContainer, imageReference: previousImage });
      await waitForHealthyContainer();
      writeStatus({
        rollback: { status: 'succeeded', image: previousImage, completedAt: Date.now() },
        runningImage: previousImage,
        updateAvailable: true,
      });
    } catch (rollbackError) {
      writeStatus({
        rollback: { status: 'failed', image: previousImage, error: rollbackError.message, completedAt: Date.now() },
      });
      throw new Error(`${error.message} Rollback also failed: ${rollbackError.message}`);
    }
    throw new Error(`${error.message} The previous image was restored.`);
  }
}

function queueOperation(operation, runner) {
  if (operationRunning) throw new Error('Another lifecycle operation is already running.');
  operationRunning = true;
  writeStatus({
    state: 'running',
    operation,
    message: `Starting ${operation}…`,
    startedAt: Date.now(),
    completedAt: null,
  });

  // Respond to the application before replacement disconnects its Socket.IO
  // clients. The persisted status remains available when the new process asks
  // for the result after reconnecting.
  setTimeout(async () => {
    try {
      const message = await runner();
      writeStatus({ state: 'succeeded', message, completedAt: Date.now() });
    } catch (error) {
      writeStatus({ state: 'failed', message: error.message, completedAt: Date.now() });
    } finally {
      operationRunning = false;
    }
  }, 500);
  return status;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/status') {
      refreshImageStatus()
        .catch(() => status)
        .then((current) => sendJson(response, 200, { available: true, ...current }));
      return;
    }
    if (request.method === 'POST' && request.url === '/check') {
      sendJson(response, 202, { available: true, ...queueOperation('check', runCheck) });
      return;
    }
    if (request.method === 'POST' && request.url === '/restart') {
      sendJson(response, 202, { available: true, ...queueOperation('restart', runRestart) });
      return;
    }
    if (request.method === 'POST' && request.url === '/update') {
      sendJson(response, 202, { available: true, ...queueOperation('update', runUpdate) });
      return;
    }
    sendJson(response, 404, { error: 'Lifecycle operation not found.' });
  } catch (error) {
    sendJson(response, 409, { error: error.message });
  }
});

fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });
fs.rmSync(SOCKET_PATH, { force: true });
server.listen(SOCKET_PATH, () => {
  // The application runs as uid 1000 while this Docker-authorized controller
  // runs as root. The socket carries only the fixed API above, so permitting
  // the application user to connect does not expose arbitrary Docker access.
  fs.chmodSync(SOCKET_PATH, 0o666);
  process.stdout.write(`Lifecycle controller listening on ${SOCKET_PATH}\n`);
});

function stop() {
  server.close(() => {
    fs.rmSync(SOCKET_PATH, { force: true });
    process.exit(0);
  });
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
