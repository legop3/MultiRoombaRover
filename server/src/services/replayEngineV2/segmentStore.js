// Replay Segment Store
// Purpose: Maintains in-memory segment index and performs file-system refresh/cleanup for replay windows.
// Scope: Handles segment discovery, overlap queries, and retention cleanup.
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const logger = require('../../globals/logger').child('replayEngineV2');
const { BUFFER_SECONDS, SEGMENT_SECONDS } = require('./constants');
const { workers, segmentIndex } = require('./state');
const { sourceKey, sourceDirForKey } = require('./sources');
const ptzCameraService = require('../ptzCameraService');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function createSegmentStore({ getActiveSegmentRoot }) {
  async function refreshIndexForWorker(worker) {
    const key = worker.key;
    const dir = sourceDirForKey(getActiveSegmentRoot(), key);
    let files;
    try {
      files = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const segmentFiles = files.filter((entry) => entry.isFile() && /^seg-\d{6}\.mp4$/.test(entry.name)).map((entry) => entry.name).sort();
    if (!segmentFiles.length) {
      segmentIndex.set(key, []);
      return;
    }

    const cutoffMs = Date.now() - BUFFER_SECONDS * 1000 - 5000;
    const entries = [];
    for (const filename of segmentFiles) {
      const filePath = path.join(dir, filename);
      let stat;
      try { stat = await fsp.stat(filePath); } catch { continue; }
      if (!stat.isFile() || stat.size < 4096) continue;
      const endMs = Math.round(stat.mtimeMs);
      const startMs = Math.round(endMs - SEGMENT_SECONDS * 1000);
      if (endMs < cutoffMs) continue;
      entries.push({
        filePath,
        startMs,
        endMs,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        kind: worker.source.kind,
        sourceType: worker.source.sourceType,
        sourceId: worker.source.id,
        roverId: worker.source.roverId || null,
      });
    }
    segmentIndex.set(key, entries.sort((a, b) => a.startMs - b.startMs));
  }

  async function refreshSegmentIndex() {
    for (const worker of Array.from(workers.values())) {
      await refreshIndexForWorker(worker);
    }
  }

  async function cleanupOldFiles() {
    const cutoff = Date.now() - BUFFER_SECONDS * 1000;
    const root = getActiveSegmentRoot();
    try {
      await ensureDir(root);
      const dirs = await fsp.readdir(root, { withFileTypes: true });
      for (const dirent of dirs) {
        if (!dirent.isDirectory()) continue;
        const dirPath = path.join(root, dirent.name);
        let files;
        try { files = await fsp.readdir(dirPath, { withFileTypes: true }); } catch { continue; }
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.mp4')) continue;
          const filePath = path.join(dirPath, file.name);
          try {
            const stat = await fsp.stat(filePath);
            if (stat.mtimeMs < cutoff) await fsp.unlink(filePath);
          } catch {}
        }
      }
    } catch (err) {
      logger.warn('cleanup failed', err.message);
    }
  }

  function getVideoEntriesForSource(source) {
    const key = sourceKey({ sourceType: String(source.type), kind: 'video', id: String(source.id) });
    return segmentIndex.get(key) || [];
  }

  function getAudioEntriesForRover(roverId) {
    const key = sourceKey({ sourceType: 'rover', kind: 'audio', id: `${String(roverId)}-audio` });
    return segmentIndex.get(key) || [];
  }

  function overlapping(entries, startMs, endMs) {
    return entries.filter((entry) => entry.endMs > startMs && entry.startMs < endMs);
  }

  async function bootstrapIndexFromDisk() {
    const root = getActiveSegmentRoot();
    await ensureDir(root);
    const dirs = await fsp.readdir(root, { withFileTypes: true });
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      segmentIndex.set(dirent.name, []);
    }
  }

  function getReplayHealthSnapshot({ BUILD_DURATION_MS, roverManager, getRoomCameras }) {
    const now = Date.now();
    const neededCount = Math.max(1, Math.ceil(BUILD_DURATION_MS / 1000));
    const sources = [];
    let readyCount = 0;

    const replaySources = [];
    for (const rover of roverManager.getRoster().filter((entry) => roverManager.canReplayRoverId(entry.id))) {
      replaySources.push({ type: 'rover', id: String(rover.id), label: rover.name || rover.id });
    }
    for (const camera of getRoomCameras()) {
      replaySources.push({ type: 'room', id: String(camera.id), label: camera.name || camera.id });
    }
    const ptzSource = ptzCameraService.getReplaySource();
    if (ptzSource) replaySources.push(ptzSource);

    for (const source of replaySources) {
      const key = sourceKey({ sourceType: source.type, kind: 'video', id: String(source.id) });
      const dir = sourceDirForKey(getActiveSegmentRoot(), key);
      let recentCount = 0;
      let lastSegmentAt = null;
      try {
        const files = fs.readdirSync(dir);
        for (const name of files) {
          if (!/^seg-\d{6}\.mp4$/.test(name)) continue;
          const full = path.join(dir, name);
          let stat;
          try { stat = fs.statSync(full); } catch { continue; }
          if (!stat.isFile() || stat.size < 4096) continue;
          if (stat.mtimeMs > (lastSegmentAt || 0)) lastSegmentAt = stat.mtimeMs;
          if (now - stat.mtimeMs <= BUFFER_SECONDS * 1000) recentCount += 1;
        }
      } catch {}
      const ready = recentCount >= neededCount;
      if (ready) readyCount += 1;
      sources.push({ type: source.type, id: source.id, label: source.label, recentCount, neededCount, lastSegmentAt, ready });
    }

    return { sources, readyCount, totalCount: sources.length };
  }

  return {
    refreshSegmentIndex,
    cleanupOldFiles,
    getVideoEntriesForSource,
    getAudioEntriesForRover,
    overlapping,
    bootstrapIndexFromDisk,
    getReplayHealthSnapshot,
  };
}

module.exports = { createSegmentStore };
