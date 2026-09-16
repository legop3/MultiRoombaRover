// Setup Code File Tests
// Purpose: Verifies the first-run credential remains private, stable, and removable.
// Scope: Uses an isolated operating-system temporary directory and never touches development server data.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { SETUP_CODE_PATTERN, createSetupCodeFile } = require('./setupCodeFile');

const temporaryRoots = [];

function createTestStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multirover-setup-code-'));
  temporaryRoots.push(root);
  return createSetupCodeFile({ filePath: path.join(root, 'setup-code.txt') });
}

test.after(() => {
  temporaryRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

test('creates one owner-readable code and reuses it across startup initialization', () => {
  const store = createTestStore();
  const firstCode = store.ensure();
  const secondCode = store.ensure();

  assert.match(firstCode, SETUP_CODE_PATTERN);
  assert.equal(secondCode, firstCode);
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), `${firstCode}\n`);
  // Mask off file-type bits so this assertion checks only Unix permissions.
  assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
});

test('rejects a malformed existing credential instead of replacing it', () => {
  const store = createTestStore();
  fs.writeFileSync(store.filePath, 'not-a-valid-code\n', { mode: 0o600 });

  assert.throws(() => store.ensure(), /Setup code file is invalid/);
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), 'not-a-valid-code\n');
});

test('rejects a setup-code symlink without reading or changing its target', () => {
  const store = createTestStore();
  const targetPath = path.join(path.dirname(store.filePath), 'unrelated.txt');
  fs.writeFileSync(targetPath, 'unrelated-content\n', { mode: 0o644 });
  fs.symlinkSync(targetPath, store.filePath);

  assert.throws(() => store.ensure(), /not a regular file/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unrelated-content\n');
  assert.equal(fs.statSync(targetPath).mode & 0o777, 0o644);
});

test('removes the credential after setup completes', () => {
  const store = createTestStore();
  store.ensure();
  store.remove();

  assert.equal(fs.existsSync(store.filePath), false);
});
