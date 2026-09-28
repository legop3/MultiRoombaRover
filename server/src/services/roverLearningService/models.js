// Published directories are immutable and become visible via atomic rename.
const fs = require('node:fs/promises');
const path = require('node:path');

async function listModels(root) {
  const directory = path.join(root, 'models');
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const models = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const metadata = JSON.parse(await fs.readFile(path.join(directory, entry.name, 'model.json'), 'utf8'));
    if (metadata.id !== entry.name) throw new Error(`Model identity mismatch: ${entry.name}`);
    models.push(metadata);
  }
  return models.sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { listModels };
