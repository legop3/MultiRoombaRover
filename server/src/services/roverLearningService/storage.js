// Recording retention only. Published models and training state are never visited.
const fs = require('node:fs/promises');
const path = require('node:path');
const { saveMetadata } = require('./recording');

async function listRecordings(root) {
  const recordings = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    // Directory names are generated, never rover IDs or user-supplied paths.
    if (!entry.isDirectory() || !/^\d+-[0-9a-f-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    let bytes = 0;
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      bytes += (await fs.stat(path.join(directory, file.name))).size;
    }
    recordings.push({ id: entry.name, directory, bytes, startedAt: Number(entry.name.split('-')[0]) });
  }
  return recordings.sort((a, b) => a.startedAt - b.startedAt);
}

async function recoverRecordings(root) {
  for (const recording of await listRecordings(root)) {
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(path.join(recording.directory, 'session.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      // An interrupted initial metadata write is retained as an unusable session
      // until ordinary retention removes it, rather than blocking all startup.
      metadata = { version: 1, id: recording.id, startedAt: recording.startedAt };
    }
    if (metadata.bufferOnly) {
      await fs.rm(recording.directory, { recursive: true, force: true });
      continue;
    }
    if (metadata.endedAt != null) continue;
    await saveMetadata(recording.directory, {
      ...metadata, endedAt: Date.now(), reason: 'interrupted',
      error: 'Previous process did not close this session; final timestamps and video may be incomplete.',
    });
  }
}

async function enforceRetention(root, activeIds, maxBytes, minimumFreeBytes) {
  const recordings = await listRecordings(root);
  let bytes = recordings.reduce((total, recording) => total + recording.bytes, 0);
  const stat = await fs.statfs(root);
  let free = stat.bavail * stat.bsize;
  for (const recording of recordings) {
    if (bytes < maxBytes && free >= minimumFreeBytes) break;
    if (activeIds.has(recording.id)) continue;
    await fs.rm(recording.directory, { recursive: true });
    bytes -= recording.bytes;
    // Re-read actual free space; sparse/compressed files and other services can
    // make a deleted file's logical size a misleading estimate of freed space.
    const current = await fs.statfs(root);
    free = current.bavail * current.bsize;
  }
  return { bytes, free, paused: bytes >= maxBytes || free < minimumFreeBytes };
}

module.exports = { recoverRecordings, enforceRetention, listRecordings };
