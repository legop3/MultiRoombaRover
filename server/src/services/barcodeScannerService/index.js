// Barcode Scanner Service
// Purpose: Owns the server-side registry and runtime state for the rover-operated barcode scanner station.
// Scope: Keeps barcode meaning, access-mode gates, and scan result formatting on the server so the scanner page stays IO-only.
const fs = require('fs');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('barcodeScannerService');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { getMode, MODES, modeEvents } = require('../modeManager');
const { sendAlert } = require('../alertService');

const DATA_DIR = resolveDataDir();
const REGISTRY_PATH = resolveDataPath('barcode-registry.json');
const RECENT_SCAN_LIMIT = 8;
const VALID_CODE_PATTERN = /^[a-z][0-9]{3}$/;

let lastKnownGoodRegistry = null;
let lastRegistryError = null;
let state = {
  lastScan: null,
  recentScans: [],
  registryError: null,
};

function isBeepAllowed() {
  const mode = getMode();
  // The page asks the server whether beeping is appropriate because the access
  // policy belongs with the rest of the server mode logic. Open and turns are
  // public access modes; admin and lockdown are closed modes where the scanner
  // should still accept input silently for operator testing.
  return mode === MODES.OPEN || mode === MODES.TURNS;
}

function normalizeCode(input) {
  // Scanners behave like keyboards, but different models can append whitespace
  // or vary casing. The scanner registry is intentionally lowercase and fixed
  // width so physical labels can remain short and easy for rover cameras/scanner
  // optics to read.
  return String(input || '').trim().toLowerCase();
}

function createDefaultRegistry() {
  return {
    codes: {
      r001: {
        type: 'rover',
        entityId: 'rover1',
        label: 'rover 1',
      },
      o001: {
        type: 'object',
        entityId: 'object1',
        label: 'object 1',
      },
    },
  };
}

function ensureRegistryFile() {
  if (fs.existsSync(REGISTRY_PATH)) return;
  // The registry file is created only when missing so future local edits remain
  // fully operator-owned. This gives the scanner system a working first-run
  // setup without silently overwriting live barcode assignments.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(createDefaultRegistry(), null, 2)}\n`, 'utf8');
}

function validateRegistry(rawRegistry) {
  if (!rawRegistry || typeof rawRegistry !== 'object' || Array.isArray(rawRegistry)) {
    throw new Error('registry root must be an object');
  }
  if (!rawRegistry.codes || typeof rawRegistry.codes !== 'object' || Array.isArray(rawRegistry.codes)) {
    throw new Error('registry.codes must be an object');
  }

  const normalizedCodes = {};
  Object.entries(rawRegistry.codes).forEach(([rawCode, rawEntry]) => {
    const code = normalizeCode(rawCode);
    if (!VALID_CODE_PATTERN.test(code)) {
      throw new Error(`invalid barcode id "${rawCode}"`);
    }
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(`registry entry ${code} must be an object`);
    }
    const type = String(rawEntry.type || '').trim().toLowerCase();
    if (type !== 'rover' && type !== 'object') {
      throw new Error(`registry entry ${code} has unsupported type "${rawEntry.type}"`);
    }
    const entityId = String(rawEntry.entityId || '').trim();
    const label = String(rawEntry.label || '').replace(/\s+/g, ' ').trim();
    if (!entityId) {
      throw new Error(`registry entry ${code} needs entityId`);
    }
    if (!label) {
      throw new Error(`registry entry ${code} needs label`);
    }
    normalizedCodes[code] = {
      type,
      entityId,
      label,
    };
  });

  return { codes: normalizedCodes };
}

function loadRegistryForScan() {
  try {
    ensureRegistryFile();
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const registry = validateRegistry(parsed);
    lastKnownGoodRegistry = registry;
    lastRegistryError = null;
    return { registry, error: null };
  } catch (err) {
    lastRegistryError = err.message;
    logger.warn('Failed to reload barcode registry; keeping last valid registry if available', {
      path: REGISTRY_PATH,
      error: err.message,
    });
    return {
      registry: lastKnownGoodRegistry,
      error: err.message,
    };
  }
}

function buildStatePayload() {
  return {
    mode: getMode(),
    beepAllowed: isBeepAllowed(),
    lastScan: state.lastScan,
    recentScans: state.recentScans,
    registryError: state.registryError,
  };
}

function broadcastState() {
  io.emit('barcode:state', buildStatePayload());
}

function sendBarcodeScanAlert(result) {
  if (!result) return;
  // Barcode scan toasts use the existing alert feed so drivers/spectators get a
  // lightweight system notice without adding any scanner-specific panels. The
  // scanner page remains the source of the big local display and speech output.
  sendAlert({
    color: result.known ? '#22c55e' : '#f59e0b',
    title: 'Barcode Scanned',
    message: result.label || result.code || 'unknown',
  });
}

function resolveScan(rawCode) {
  const code = normalizeCode(rawCode);
  const loaded = loadRegistryForScan();
  const registry = loaded.registry;
  const scannedAt = Date.now();

  if (!VALID_CODE_PATTERN.test(code)) {
    return {
      code,
      known: false,
      type: null,
      entityId: null,
      label: 'unknown',
      speechText: 'unknown',
      scannedAt,
      registryError: loaded.error || null,
      error: code ? 'invalid barcode format' : 'empty barcode',
    };
  }

  if (!registry) {
    return {
      code,
      known: false,
      type: null,
      entityId: null,
      label: 'unknown',
      speechText: 'unknown',
      scannedAt,
      registryError: loaded.error || 'barcode registry unavailable',
      error: 'barcode registry unavailable',
    };
  }

  const entry = registry.codes[code] || null;
  if (!entry) {
    return {
      code,
      known: false,
      type: null,
      entityId: null,
      // Unknown but well-formed barcodes should be visible/audible as the code
      // itself. That makes mis-labeled objects and new unregistered barcodes
      // debuggable from the rover-facing scanner page without adding any extra
      // UI panels or registry-management logic to the browser.
      label: `Unknown: ${code}`,
      speechText: `Unknown: ${code}`,
      scannedAt,
      registryError: loaded.error || null,
      error: null,
    };
  }

  return {
    code,
    known: true,
    type: entry.type,
    entityId: entry.entityId,
    label: entry.label,
    speechText: entry.label,
    scannedAt,
    registryError: loaded.error || null,
    error: null,
  };
}

function applyScan(rawCode) {
  const result = resolveScan(rawCode);
  // The latest result is the canonical display state. Recent scans are retained
  // only for debugging and future scanner-page variants; the rover-facing first
  // pass can ignore them and simply render lastScan.
  state = {
    lastScan: result,
    recentScans: [result, ...state.recentScans].slice(0, RECENT_SCAN_LIMIT),
    registryError: result.registryError || null,
  };
  broadcastState();
  sendBarcodeScanAlert(result);
  return result;
}

io.on('connection', (socket) => {
  socket.emit('barcode:state', buildStatePayload());
  socket.on('barcode:scan', ({ code } = {}, cb = () => {}) => {
    try {
      const result = applyScan(code);
      cb({ success: true, result, state: buildStatePayload() });
    } catch (err) {
      // Socket handlers should never let a malformed scan or registry edge case
      // bubble out to the process. The page gets a normal failed acknowledgement
      // and the service keeps running for the next scan.
      logger.warn('Barcode scan failed unexpectedly', err);
      cb({ error: err.message || 'barcode scan failed' });
    }
  });
});

modeEvents.on('change', () => {
  // Access-mode changes affect whether the scanner page should beep when it
  // submits a code, so scanner clients need a fresh state packet even without a
  // new scan.
  broadcastState();
});

loadRegistryForScan();

module.exports = {
  REGISTRY_PATH,
  applyScan,
  buildStatePayload,
};
