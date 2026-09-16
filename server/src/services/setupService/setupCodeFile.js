// Setup Code File
// Purpose: Persists the one-time first-run credential inside the server data directory.
// Scope: Owns secure file creation, validation, reuse, and removal without knowing whether setup is complete.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveDataPath } = require('../../helpers/dataPaths');

const DEFAULT_SETUP_CODE_PATH = resolveDataPath('setup-code.txt');
const SETUP_CODE_PATTERN = /^[0-9a-f]{12}$/;

function createSetupCodeFile({ filePath = DEFAULT_SETUP_CODE_PATH } = {}) {
  function read() {
    const fileStats = fs.lstatSync(filePath);
    if (!fileStats.isFile()) {
      // In particular, reject symbolic links before chmod or read operations so
      // a writable data directory cannot redirect setup handling to another file.
      throw new Error(`Setup code path is not a regular file: ${filePath}`);
    }
    fs.chmodSync(filePath, 0o600);
    const code = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
    if (!SETUP_CODE_PATTERN.test(code)) {
      /*
        Never silently replace a malformed credential. An operator may already
        be reading that file, and changing it behind their back would make setup
        failures mysterious while concealing possible filesystem corruption.
      */
      throw new Error(`Setup code file is invalid: ${filePath}`);
    }
    return code;
  }

  function ensure() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      return read();
    }

    const code = crypto.randomBytes(6).toString('hex');
    try {
      /*
        Exclusive creation prevents two accidentally overlapping server starts
        from overwriting one another's setup credential. The file is the source
        an operator reads, so the accepted code must always match its contents.
      */
      fs.writeFileSync(filePath, `${code}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return code;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return read();
    }
  }

  function remove() {
    fs.rmSync(filePath, { force: true });
  }

  return {
    filePath,
    ensure,
    read,
    remove,
  };
}

module.exports = {
  DEFAULT_SETUP_CODE_PATH,
  SETUP_CODE_PATTERN,
  createSetupCodeFile,
};
