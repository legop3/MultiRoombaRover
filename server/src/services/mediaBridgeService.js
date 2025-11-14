const { loadConfig } = require('../helpers/configLoader');
const logger = require('../globals/logger').child('mediaBridge');
const { managerEvents, rovers } = require('./roverManager');

const mediaConfig = loadConfig().media || {};
const apiBase = (mediaConfig.mediamtxApiUrl || '').replace(/\/$/, '');
const RESYNC_INTERVAL_MS = 60000;

if (!apiBase) {
  logger.info('media bridge disabled (media.mediamtxApiUrl not set)');
  return;
}

const activeSources = new Map(); // roverId -> { source }

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

// ensure existing rovers are bridged even if this module loads after them
resyncAll(true);
const interval = setInterval(() => resyncAll(true), RESYNC_INTERVAL_MS);
if (interval.unref) interval.unref();

async function resyncAll(force = false) {
  for (const record of rovers.values()) {
    syncRover(record, { force }).catch((err) => {
      logger.error('failed to resync rover %s: %s', record.id, err.message);
    });
  }
}

async function syncRover(record, { force = false } = {}) {
  if (!record?.id) return;
  const source = normalizeSource(record?.meta?.media?.whepUrl);
  if (!source) {
    await removePath(record.id);
    return;
  }
  const current = activeSources.get(record.id);
  if (!force && current?.source === source) {
    return;
  }
  await upsertPath(record.id, source);
  activeSources.set(record.id, { source, syncedAt: Date.now() });
  if (current?.source === source && force) {
    logger.info('bridge path refreshed for %s', record.id);
  } else {
    logger.info('bridge path ready for %s -> %s', record.id, source);
  }
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
  if (!roverId) {
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

function normalizeSource(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^wheps?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol === 'https:' ? 'wheps' : 'whep';
    let pathname = parsed.pathname || '/';
    if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }
    return `${protocol}://${parsed.host}${pathname}${parsed.search || ''}`;
  } catch (err) {
    logger.warn('invalid WHEP URL provided by rover (%s): %s', raw, err.message);
    return null;
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
