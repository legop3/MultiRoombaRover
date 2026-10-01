const { POLICY_VERSION } = require('./capabilities');
// Mutable aliases reference immutable checkpoints. All readers and retention share
// a queue so a model cannot disappear between resolving its alias and loading it.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const UUID = /^[0-9a-f-]{36}$/;
let queue = Promise.resolve();
const leases = new Map();
const retired = new Set();
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
const checkpointRoot = (root) => path.join(root, 'training', 'checkpoints');
async function index(root) {
  try { return JSON.parse(await fs.readFile(path.join(checkpointRoot(root), 'index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function metadata(directory) {
  const model = JSON.parse(await fs.readFile(path.join(directory, 'model.json'), 'utf8'));
  if (model?.id !== path.basename(directory)) throw new Error('Model identity mismatch');
  return model;
}
async function prune(root, state) {
  const directory = checkpointRoot(root);
  await fs.mkdir(directory, { recursive: true });
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (/^\.[0-9a-f-]{36}\.pending$/.test(entry.name)) {
      await fs.rm(path.join(directory, entry.name), { recursive: true });
      continue;
    }
    if (!UUID.test(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (!Object.values(state).includes(entry.name)) {
      if (leases.has(target)) retired.add(target);
      else { await fs.rm(target, { recursive: true }); retired.delete(target); }
    }
  }
}
function adoptCheckpoint(root, model, promote) {
  return serial(async () => {
    const state = await index(root);
    if (!UUID.test(model.id)) throw new Error('Invalid checkpoint identity');
    await metadata(path.join(checkpointRoot(root), model.id));
    state.candidate = model.id;
    if (promote) { state.previous = state.latest || null; state.latest = model.id; }
    const filename = path.join(checkpointRoot(root), 'index.json');
    await fs.writeFile(`${filename}.tmp`, JSON.stringify(state));
    await fs.rename(`${filename}.tmp`, filename);
    await prune(root, state);
  });
}
function acquireModel(root, id) {
  return serial(async () => {
    const state = await index(root);
    const alias = ['latest', 'previous'].includes(id);
    const resolved = alias ? state[id] : id;
    if (!UUID.test(resolved || '')) throw new Error('Model is not available');
    const directory = path.join(alias ? checkpointRoot(root) : path.join(root, 'models'), resolved);
    const model = await metadata(directory);
    leases.set(directory, (leases.get(directory) || 0) + 1);
    let released = false;
    return { directory, metadata: model, release: () => serial(async () => {
      if (released) return;
      released = true;
      const count = leases.get(directory) - 1;
      if (count) leases.set(directory, count); else leases.delete(directory);
      // Delete only a specific checkpoint already retired by the trainer, not
      // a worker's new export awaiting adoption.
      if (!count && retired.has(directory)) {
        await fs.rm(directory, { recursive: true, force: true });
        retired.delete(directory);
      }
    }) };
  });
}
function saveSnapshot(root) {
  return serial(async () => {
    const state = await index(root);
    if (!UUID.test(state.candidate || '')) throw new Error('No completed learner checkpoint yet');
    const source = path.join(checkpointRoot(root), state.candidate);
    const original = await metadata(source);
    if (original.specification?.version !== POLICY_VERSION) throw new Error('Waiting for a completed command-policy checkpoint');
    const id = randomUUID();
    const words = [['amber', 'silver', 'quiet', 'curious'], ['otter', 'finch', 'fox', 'wren']];
    const name = `${words[0][randomInt(4)]}-${words[1][randomInt(4)]}-${id.slice(0, 8)}`;
    const model = { ...original, id, name, createdAt: Date.now(), sourceCheckpointId: original.id,
      snapshot: true, experimental: original.evaluation !== 'passed imitation gate' };
    const destination = path.join(root, 'models', id);
    const pending = path.join(root, 'models', `.${id}.pending`);
    await fs.mkdir(pending, { recursive: true });
    try {
      await fs.copyFile(path.join(source, 'weights.pt'), path.join(pending, 'weights.pt'));
      await fs.writeFile(path.join(pending, 'model.json'), JSON.stringify(model));
      await fs.rename(pending, destination);
    } catch (error) { await fs.rm(pending, { recursive: true, force: true }); throw error; }
    return model;
  });
}
// Retire recognized older policies before workers start. Unknown/malformed or
// future manifests are not evidence that a directory is disposable.
function removeObsoleteModels(root) {
  return serial(async () => {
    const obsolete = [];
    for (const directory of [path.join(root, 'models'), checkpointRoot(root)]) {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        const target = path.join(directory, entry.name);
        let model;
        try { model = await metadata(target); }
        catch (error) {
          if (error.code === 'ENOENT' || error instanceof SyntaxError || error.message === 'Model identity mismatch') continue;
          throw error;
        }
        const version = model.specification?.version;
        if (Number.isInteger(version) && version >= 1 && version < POLICY_VERSION) {
          obsolete.push({ target, checkpoint: directory === checkpointRoot(root), id: entry.name });
        }
      }
    }
    const state = await index(root);
    const oldCheckpoints = new Set(obsolete.filter((entry) => entry.checkpoint).map((entry) => entry.id));
    let changed = false;
    for (const alias of ['candidate', 'latest', 'previous']) {
      if (oldCheckpoints.has(state[alias])) { delete state[alias]; changed = true; }
    }
    // Remove aliases atomically first, so interruption cannot leave the catalog
    // referring to a checkpoint that cleanup already deleted.
    if (changed) {
      const filename = path.join(checkpointRoot(root), 'index.json');
      await fs.writeFile(`${filename}.tmp`, JSON.stringify(state));
      await fs.rename(`${filename}.tmp`, filename);
    }
    for (const { target } of obsolete) {
      if (leases.has(target)) retired.add(target);
      else { await fs.rm(target, { recursive: true, force: true }); retired.delete(target); }
    }
    // These filenames belong to superseded optimizer/scheduler lineages, not
    // policy versions. The current command policy uses lineage v6.
    for (const suffix of ['', '-v1', '-v2', '-v3', '-v4', '-v5']) {
      for (const filename of [`resume${suffix}.pt`, `resume${suffix}.tmp`,
        `schedule${suffix}.json`, `schedule${suffix}.json.tmp`]) {
        await fs.rm(path.join(root, 'training', filename), { force: true });
      }
    }
  });
}

function listModels(root) {
  return serial(async () => {
    let entries;
    try { entries = await fs.readdir(path.join(root, 'models'), { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    const models = [];
    const state = await index(root);
    for (const alias of ['latest', 'previous']) {
      if (!state[alias]) continue;
      const model = await metadata(path.join(checkpointRoot(root), state[alias]));
      models.push({ ...model, id: alias, checkpointId: model.id, name: alias === 'latest' ? 'Latest' : 'Previous', automatic: true });
    }
    for (const entry of entries) {
      if (entry.isDirectory() && UUID.test(entry.name)) models.push(await metadata(path.join(root, 'models', entry.name)));
    }
    return models;
  });
}
module.exports = { removeObsoleteModels, listModels, acquireModel, adoptCheckpoint, saveSnapshot };
