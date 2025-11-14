const { loadConfig } = require('../helpers/configLoader');
const logger = require('../globals/logger').child('mediaBridge');
const { managerEvents, rovers } = require('./roverManager');

const mediaConfig = loadConfig().media || {};
const apiBase = (mediaConfig.mediamtxApiUrl || '').replace(/\/$/, '');

if (!apiBase) {
  logger.info('media bridge disabled (media.mediamtxApiUrl not set)');
  return;
}

const activeSources = new Map(); // roverId -> source

managerEvents.on('rover', (evt) => {
  if (evt.action === 'upsert' && evt.record) {
    syncRover(evt.record).catch((err) => {
      logger.error('failed to sync rover %s: %s', evt.roverId, err.message);
    });
  } else if (evt.action === 'removed') {
    removePath(evt.roverId).catch((err) => {
      logger.error('failed to remove rover %s path: %s', evt.roverId, err.message);
    });
  }
});
// guh
// Initialize existing rovers (in case service loads after they connect)
for (const record of rovers.values()) {
  syncRover(record).catch((err) => {
    logger.error('failed to sync rover %s on init: %s', record.id, err.message);
  });
}

async function syncRover(record) {
  if (!record?.meta?.media) {
    await removePath(record?.id);
    return;
  }
  const source = record.meta.media.bridgeWhepUrl;
  if (!source) {
    logger.warn(
      'rover %s missing bridgeWhepUrl; video bridge disabled for this rover',
      record.id
    );
    await removePath(record.id);
    return;
  }
  if (activeSources.get(record.id) === source) {
    return;
  }
  await upsertPath(record.id, source);
  activeSources.set(record.id, source);
  logger.info('bridge path ready for %s -> %s', record.id, source);
}

async function upsertPath(roverId, source) {
  const body = {
    source,
    sourceOnDemand: false,
  };
  try {
    await callApi('POST', `/v3/config/paths/replace/${encodeURIComponent(roverId)}`, body);
  } catch (err) {
    if (err.status === 404) {
      await callApi('POST', `/v3/config/paths/add/${encodeURIComponent(roverId)}`, body);
    } else {
      throw err;
    }
  }
}

async function removePath(roverId) {
  if (!roverId || !activeSources.has(roverId)) {
    activeSources.delete(roverId);
    return;
  }
  activeSources.delete(roverId);
  try {
    await callApi('POST', `/v3/config/paths/delete/${encodeURIComponent(roverId)}`, {});
    logger.info('bridge path removed for %s', roverId);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
}

async function callApi(method, path, body) {
  const url = `${apiBase}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : null;
}
