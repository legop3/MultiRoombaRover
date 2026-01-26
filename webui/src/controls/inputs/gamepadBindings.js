const CURVE_EXPO = 1.6;

export function getPadSignature(pad) {
  if (!pad) return 'unknown::none::0::0';
  const id = pad.id || 'unknown';
  const mapping = pad.mapping || 'none';
  const axes = Array.isArray(pad.axes) ? pad.axes.length : 0;
  const buttons = Array.isArray(pad.buttons) ? pad.buttons.length : 0;
  return `${id}::${mapping}::${axes}::${buttons}`;
}

export function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile ?? {}));
}

export function createProfileForPad(pad, baseProfile) {
  const profile = cloneProfile(baseProfile);
  profile.meta = {
    id: pad?.id ?? 'Unknown',
    mapping: pad?.mapping ?? 'none',
    axes: pad?.axes?.length ?? 0,
    buttons: pad?.buttons?.length ?? 0,
  };
  return profile;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function applyCurve(value, curve) {
  if (!value) return 0;
  const abs = Math.abs(value);
  if (curve === 'expo') {
    return Math.sign(value) * Math.pow(abs, CURVE_EXPO);
  }
  return value;
}

function applyAxisDeadzone(value, deadzone) {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  const scaled = (abs - deadzone) / (1 - deadzone);
  return Math.sign(value) * scaled;
}

function applyRadialDeadzone(x, y, deadzone) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return { x: 0, y: 0 };
  const scaled = (mag - deadzone) / (1 - deadzone);
  const ratio = scaled / mag;
  return { x: x * ratio, y: y * ratio };
}

function readAxis(padState, index) {
  if (!padState || !Array.isArray(padState.axes)) return null;
  const value = padState.axes[index];
  if (!Number.isFinite(value)) return null;
  return clampUnit(value);
}

function readButton(padState, index) {
  if (!padState || !Array.isArray(padState.buttons)) return null;
  const btn = padState.buttons[index];
  if (!btn) return null;
  const value = typeof btn.value === 'number' ? btn.value : btn.pressed ? 1 : 0;
  return {
    pressed: Boolean(btn.pressed || value > 0.5),
    value: Math.max(0, Math.min(1, value)),
  };
}

function resolveAxisSource(padState, sources = []) {
  for (const source of sources) {
    if (!source) continue;
    if (source.kind === 'axis') {
      const value = readAxis(padState, source.index);
      if (value === null) continue;
      return { value: source.invert ? -value : value, source };
    }
    if (source.kind === 'buttonAxis') {
      const button = readButton(padState, source.index);
      if (!button) continue;
      return { value: clampUnit(button.value), source };
    }
  }
  return { value: 0, source: null };
}

function resolveAxisPairSource(padState, sources = []) {
  for (const source of sources) {
    if (!source || source.kind !== 'axisPair') continue;
    const rawX = readAxis(padState, source.x);
    const rawY = readAxis(padState, source.y);
    if (rawX === null || rawY === null) continue;
    const x = source.invertX ? -rawX : rawX;
    const y = source.invertY ? -rawY : rawY;
    return { x, y, source };
  }
  return { x: 0, y: 0, source: null };
}

function resolveButtonSource(padState, sources = []) {
  for (const source of sources) {
    if (!source) continue;
    if (source.kind === 'button') {
      const btn = readButton(padState, source.index);
      if (!btn) continue;
      return { pressed: btn.pressed, source };
    }
    if (source.kind === 'axisButton') {
      const value = readAxis(padState, source.index);
      if (value === null) continue;
      const direction = source.direction || 1;
      const threshold = typeof source.threshold === 'number' ? source.threshold : 0.6;
      return { pressed: value * direction > threshold, source };
    }
    if (source.kind === 'buttonAxis') {
      const btn = readButton(padState, source.index);
      if (!btn) continue;
      return { pressed: btn.value > 0.5, source };
    }
  }
  return { pressed: false, source: null };
}

export function computeGamepadOutputs(padState, profile) {
  const bindings = profile?.bindings ?? {};
  const calibration = profile?.calibration ?? {};

  const driveBinding = bindings.drive ?? {};
  const driveSource = resolveAxisPairSource(padState, driveBinding.sources);
  let driveX = clampUnit(driveSource.x);
  let driveY = clampUnit(driveSource.y);
  const driveDeadzone = Math.min(Math.max(calibration.driveDeadzone ?? 0.18, 0), 0.8);
  const driveCurved = applyRadialDeadzone(driveX, driveY, driveDeadzone);
  driveX = applyCurve(driveCurved.x, calibration.driveCurve);
  driveY = applyCurve(driveCurved.y, calibration.driveCurve);

  const cameraBinding = bindings.cameraTilt ?? {};
  const cameraSource = resolveAxisSource(padState, cameraBinding.sources);
  const cameraDeadzone = Math.min(Math.max(calibration.cameraDeadzone ?? 0.08, 0), 0.8);
  let cameraAxis = applyAxisDeadzone(clampUnit(cameraSource.value), cameraDeadzone);
  cameraAxis = applyCurve(cameraAxis, calibration.cameraCurve);

  const auxDeadzone = Math.min(Math.max(calibration.auxDeadzone ?? 0.05, 0), 0.6);
  const mainBinding = bindings.mainBrush ?? {};
  const mainSource = resolveAxisSource(padState, mainBinding.sources);
  let mainAxis = applyAxisDeadzone(clampUnit(mainSource.value), auxDeadzone);
  mainAxis = applyCurve(mainAxis, calibration.auxCurve);

  const sideBinding = bindings.sideBrush ?? {};
  const sideSource = resolveAxisSource(padState, sideBinding.sources);
  let sideAxis = applyAxisDeadzone(clampUnit(sideSource.value), auxDeadzone);
  sideAxis = applyCurve(sideAxis, calibration.auxCurve);

  const vacuumSource = resolveButtonSource(padState, bindings.vacuum?.sources);
  const allAuxSource = resolveButtonSource(padState, bindings.allAux?.sources);
  const mainReverseSource = resolveButtonSource(padState, bindings.mainReverse?.sources);
  const sideReverseSource = resolveButtonSource(padState, bindings.sideReverse?.sources);
  const driveMacroSource = resolveButtonSource(padState, bindings.driveMacro?.sources);
  const dockMacroSource = resolveButtonSource(padState, bindings.dockMacro?.sources);
  const nightVisionSource = resolveButtonSource(padState, bindings.nightVisionToggle?.sources);

  return {
    driveVector: { x: driveX, y: driveY, boost: false },
    cameraAxis,
    auxAxis: { main: mainAxis, side: sideAxis },
    buttons: {
      vacuum: vacuumSource.pressed,
      allAux: allAuxSource.pressed,
      mainReverse: mainReverseSource.pressed,
      sideReverse: sideReverseSource.pressed,
      driveMacro: driveMacroSource.pressed,
      dockMacro: dockMacroSource.pressed,
      nightVisionToggle: nightVisionSource.pressed,
    },
    sources: {
      drive: driveSource.source,
      cameraTilt: cameraSource.source,
      mainBrush: mainSource.source,
      sideBrush: sideSource.source,
      vacuum: vacuumSource.source,
      allAux: allAuxSource.source,
      mainReverse: mainReverseSource.source,
      sideReverse: sideReverseSource.source,
      driveMacro: driveMacroSource.source,
      dockMacro: dockMacroSource.source,
      nightVisionToggle: nightVisionSource.source,
    },
  };
}
