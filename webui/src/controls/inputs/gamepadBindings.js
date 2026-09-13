// Gamepad Bindings
// Purpose: Defines default gamepad axis/button-to-action mappings and lookup helpers. Scope: Supplies binding metadata for gamepad input manager and settings UI.
const CURVE_EXPO = 1.6;
const ABSOLUTE_CAMERA_DEADZONE = 0.01;

/*
  Binary actions share one resolver so the runtime, settings UI, diagnostics, and adaptive
  prompts all operate on the same complete action set. Adding an action here is intentionally
  controller-local and does not add controller concepts to the shared command pipeline.
*/
export const GAMEPAD_BUTTON_ACTION_IDS = [
  'tankCameraUp',
  'tankCameraDown',
  'vacuum',
  'allAux',
  'mainReverse',
  'sideReverse',
  'driveMacro',
  'dockMacro',
  'headlightToggle',
  'laserToggle',
  'boostModifier',
  'slowModifier',
  'hornHonk',
  'micPtt',
  'videoFilterCycle',
  'chatFocus',
  'songNoteUp',
  'songNoteDown',
  'homeAssistantOn',
  'homeAssistantOff',
  'auxMainForward',
  'auxMainReverse',
  'auxSideForward',
  'auxSideReverse',
  'auxVacuumFast',
  'auxVacuumSlow',
  'auxAllForward',
];

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

export function resolveGamepadProfile(profile, defaults) {
  /*
    Profiles are persisted independently per controller. Merge at the binding and calibration
    levels so adding a newly supported logical action immediately gives existing controllers a
    usable default without overwriting any binding the user deliberately customized.
  */
  const base = defaults ?? {};
  const current = profile ?? {};
  const requiresBehaviorUpgrade = current.behaviorVersion !== base.behaviorVersion;
  return {
    ...base,
    ...current,
    behaviorVersion: base.behaviorVersion,
    /* Old detector-specific prompt values are invalid for the replacement library. Returning to
       automatic detection ensures a previously selected workaround cannot mask the real device. */
    promptStyle: requiresBehaviorUpgrade ? base.promptStyle : current.promptStyle ?? base.promptStyle,
    calibration: {
      ...(base.calibration ?? {}),
      ...(current.calibration ?? {}),
      /* Profile upgrades retain personal response tuning except for defaults whose old values
         caused broken camera behavior or imposed an unintended drive-speed ceiling. */
      ...(requiresBehaviorUpgrade
        ? {
            cameraMode: base.calibration?.cameraMode,
            baseSpeed: base.calibration?.baseSpeed,
          }
        : {}),
    },
    bindings: {
      /* Version four intentionally replaces the old arbitrary default layout as one coherent
         migration. Bindings are controller-local preferences, and the project does not retain
         backwards compatibility with obsolete layouts; calibration and hardware metadata remain. */
      ...(requiresBehaviorUpgrade
        ? cloneProfile(base.bindings ?? {})
        : { ...(base.bindings ?? {}), ...(current.bindings ?? {}) }),
    },
  };
}

export function advanceCameraAngle(currentAngle, axisValue, sensitivity, elapsedMs, limits) {
  /* Velocity camera state must never accumulate beyond the physical servo limits. Otherwise a
     long hold at an endpoint creates an invisible overshoot that has to unwind before reversing. */
  const min = Number.isFinite(limits?.min) ? limits.min : -45;
  const max = Number.isFinite(limits?.max) ? limits.max : 45;
  const baseline = Number.isFinite(currentAngle) ? currentAngle : (min + max) / 2;
  const safeElapsedMs = Math.max(0, Math.min(50, Number(elapsedMs) || 0));
  const degreesPerSecond = Math.max(1, Math.min(180, Number(sensitivity) || 60));
  const candidate = baseline + axisValue * degreesPerSecond * (safeElapsedMs / 1000);
  return Math.max(min, Math.min(max, candidate));
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
  let firstReadableSource = null;
  for (const source of sources) {
    if (!source) continue;
    if (source.kind === 'chord') {
      const inputs = Array.isArray(source.inputs) ? source.inputs : [];
      if (inputs.length === 0) continue;
      const pressed = inputs.every((input) => resolveButtonSource(padState, [input]).pressed);
      if (pressed) return { pressed: true, source };
      firstReadableSource ??= source;
      continue;
    }
    if (source.kind === 'button') {
      const btn = readButton(padState, source.index);
      if (!btn) continue;
      if (btn.pressed) return { pressed: true, source };
      firstReadableSource ??= source;
      continue;
    }
    if (source.kind === 'axisButton') {
      const value = readAxis(padState, source.index);
      if (value === null) continue;
      const direction = source.direction || 1;
      const threshold = typeof source.threshold === 'number' ? source.threshold : 0.6;
      if (value * direction > threshold) return { pressed: true, source };
      firstReadableSource ??= source;
      continue;
    }
    if (source.kind === 'buttonAxis') {
      const btn = readButton(padState, source.index);
      if (!btn) continue;
      if (btn.value > 0.5) return { pressed: true, source };
      firstReadableSource ??= source;
    }
  }
  return { pressed: false, source: firstReadableSource };
}

export function computeGamepadOutputs(padState, profile) {
  const bindings = profile?.bindings ?? {};
  const calibration = profile?.calibration ?? {};

  const driveDeadzone = Math.min(Math.max(calibration.driveDeadzone ?? 0.18, 0), 0.8);
  const driveMode = calibration.driveMode === 'tank' ? 'tank' : 'single';
  let driveX = 0;
  let driveY = 0;
  let driveSources;
  let tankTracks = null;

  if (driveMode === 'tank') {
    const leftSource = resolveAxisSource(padState, bindings.tankLeft?.sources);
    const rightSource = resolveAxisSource(padState, bindings.tankRight?.sources);
    /* Each track gets its own axial deadzone and response curve before mixing. Applying a radial
       deadzone to two independent throttles would make one track's drift or movement change the
       activation threshold of the other, which is especially unpleasant during slow pivots. */
    const leftTrack = applyCurve(
      applyAxisDeadzone(clampUnit(leftSource.value), driveDeadzone),
      calibration.driveCurve,
    );
    const rightTrack = applyCurve(
      applyAxisDeadzone(clampUnit(rightSource.value), driveDeadzone),
      calibration.driveCurve,
    );
    /* The shared drive mixer later computes left = forward + turn and right = forward - turn.
       This inverse transform therefore preserves the requested track values exactly while keeping
       tank-controller knowledge out of ControlContext and the rover command transport. */
    driveX = clampUnit((leftTrack - rightTrack) / 2);
    driveY = clampUnit((leftTrack + rightTrack) / 2);
    tankTracks = { left: leftTrack, right: rightTrack };
    driveSources = { tankLeft: leftSource.source, tankRight: rightSource.source };
  } else {
    const driveBinding = bindings.drive ?? {};
    const driveSource = resolveAxisPairSource(padState, driveBinding.sources);
    const driveCurved = applyRadialDeadzone(
      clampUnit(driveSource.x),
      clampUnit(driveSource.y),
      driveDeadzone,
    );
    driveX = applyCurve(driveCurved.x, calibration.driveCurve);
    driveY = applyCurve(driveCurved.y, calibration.driveCurve);
    driveSources = { drive: driveSource.source };
  }

  const cameraBinding = bindings.cameraTilt ?? {};
  const cameraSource = driveMode === 'tank'
    ? { value: 0, source: null }
    : resolveAxisSource(padState, cameraBinding.sources);
  /* Absolute mode maps the stick directly across the servo's physical range. Its center needs
     only a tiny noise guard; applying the velocity deadzone there creates a visibly unresponsive
     band around the home angle and makes small position corrections feel delayed. */
  const configuredCameraDeadzone = Math.min(
    Math.max(calibration.cameraDeadzone ?? 0.08, 0),
    0.8,
  );
  const cameraDeadzone = calibration.cameraMode === 'absolute'
    ? ABSOLUTE_CAMERA_DEADZONE
    : configuredCameraDeadzone;
  let cameraAxis = applyAxisDeadzone(clampUnit(cameraSource.value), cameraDeadzone);

  const auxDeadzone = Math.min(Math.max(calibration.auxDeadzone ?? 0.05, 0), 0.6);
  const mainBinding = bindings.mainBrush ?? {};
  const mainSource = resolveAxisSource(padState, mainBinding.sources);
  let mainAxis = applyAxisDeadzone(clampUnit(mainSource.value), auxDeadzone);
  mainAxis = applyCurve(mainAxis, calibration.auxCurve);

  const sideBinding = bindings.sideBrush ?? {};
  const sideSource = resolveAxisSource(padState, sideBinding.sources);
  let sideAxis = applyAxisDeadzone(clampUnit(sideSource.value), auxDeadzone);
  sideAxis = applyCurve(sideAxis, calibration.auxCurve);

  const buttonOutputs = Object.fromEntries(
    GAMEPAD_BUTTON_ACTION_IDS.map((actionId) => {
      /* D-pad vertical has two deliberate owners, one per steering mode. Suppressing the inactive
         owner here lets both recommended layouts coexist in one controller profile without a
         camera press also playing a song note after switching to tank steering. */
      const inactiveForMode =
        (driveMode === 'tank' && (actionId === 'songNoteUp' || actionId === 'songNoteDown')) ||
        (driveMode === 'single' && (actionId === 'tankCameraUp' || actionId === 'tankCameraDown'));
      return [
        actionId,
        inactiveForMode
          ? { pressed: false, source: null }
          : resolveButtonSource(padState, bindings[actionId]?.sources),
      ];
    }),
  );

  if (driveMode === 'tank') {
    /* Direction buttons form the signed equivalent of the single analog camera axis. Opposing
       presses cancel to zero, providing an immediate and deterministic stop for velocity mode. */
    cameraAxis = Number(buttonOutputs.tankCameraUp.pressed) -
      Number(buttonOutputs.tankCameraDown.pressed);
  }
  cameraAxis = applyCurve(cameraAxis, calibration.cameraCurve);

  return {
    driveVector: { x: driveX, y: driveY, boost: false },
    // Track values are diagnostic-only; the runtime continues consuming driveVector exclusively.
    tankTracks,
    cameraAxis,
    auxAxis: { main: mainAxis, side: sideAxis },
    buttons: Object.fromEntries(
      Object.entries(buttonOutputs).map(([actionId, output]) => [actionId, output.pressed]),
    ),
    sources: {
      ...driveSources,
      cameraTilt: driveMode === 'tank'
        ? buttonOutputs.tankCameraUp.source ?? buttonOutputs.tankCameraDown.source
        : cameraSource.source,
      mainBrush: mainSource.source,
      sideBrush: sideSource.source,
      ...Object.fromEntries(
        Object.entries(buttonOutputs).map(([actionId, output]) => [actionId, output.source]),
      ),
    },
  };
}
