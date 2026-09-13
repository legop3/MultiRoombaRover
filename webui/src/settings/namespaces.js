// Settings Namespaces
// Purpose: Defines namespace identifiers used to segment persisted settings data. Scope: Prevents key collisions and standardizes settings lookup domains.
export const INPUT_SETTINGS_DEFAULTS = {
  keyboard: {
    baseSpeed: 210,
    turboSpeed: 500,
    precisionSpeed: 100,
    tiltSpeed: 90,
    tiltIntervalMs: 110,
  },
};

export const GAMEPAD_PROFILE_DEFAULT = {
  behaviorVersion: 4,
  label: 'Default',
  promptStyle: 'auto',
  calibration: {
    // Steering mode changes only how controller axes are interpreted. Both modes still emit the
    // same normalized drive vector consumed by the shared rover control pipeline.
    driveMode: 'single',
    driveDeadzone: 0.18,
    cameraDeadzone: 0.08,
    auxDeadzone: 0.05,
    driveCurve: 'linear',
    cameraCurve: 'linear',
    auxCurve: 'linear',
    cameraMode: 'velocity',
    cameraSensitivity: 60,
    auxSideScale: 0.55,
    baseSpeed: 500,
    turboSpeed: 500,
    precisionSpeed: 100,
  },
  bindings: {
    drive: {
      kind: 'axisPair',
      sources: [{ kind: 'axisPair', x: 0, y: 1, invertX: false, invertY: true }],
    },
    // Tank steering treats the two vertical stick axes as independent wheel throttles. These
    // remain separate bindings so controllers with unusual layouts can capture and invert each
    // track without affecting the conventional single-stick mapping above.
    tankLeft: {
      kind: 'axis',
      sources: [{ kind: 'axis', index: 1, invert: true }],
    },
    tankRight: {
      kind: 'axis',
      sources: [{ kind: 'axis', index: 3, invert: true }],
    },
    cameraTilt: {
      kind: 'axis',
      sources: [{ kind: 'axis', index: 3, invert: true }],
    },
    // Tank mode consumes both stick Y axes for driving, so its existing camera axis is exposed as
    // two independently remappable buttons. Runtime combines them into the same signed camera
    // value used by the analog single-stick binding; no camera-specific command path is added.
    tankCameraUp: {
      kind: 'button',
      sources: [{ kind: 'button', index: 12 }],
    },
    tankCameraDown: {
      kind: 'button',
      sources: [{ kind: 'button', index: 13 }],
    },
    mainBrush: {
      kind: 'axis',
      sources: [{ kind: 'buttonAxis', index: 6 }],
    },
    sideBrush: {
      kind: 'axis',
      sources: [{ kind: 'buttonAxis', index: 7 }],
    },
    vacuum: {
      kind: 'button',
      sources: [{ kind: 'button', index: 1 }],
    },
    allAux: {
      kind: 'button',
      sources: [{ kind: 'button', index: 0 }],
    },
    mainReverse: {
      kind: 'button',
      sources: [],
    },
    sideReverse: {
      kind: 'button',
      sources: [],
    },
    driveMacro: {
      kind: 'button',
      sources: [{ kind: 'button', index: 9 }],
    },
    dockMacro: {
      kind: 'button',
      sources: [{ kind: 'button', index: 3 }],
    },
    headlightToggle: {
      kind: 'button',
      sources: [{ kind: 'button', index: 4 }],
    },
    laserToggle: {
      kind: 'button',
      sources: [{ kind: 'button', index: 5 }],
    },
    boostModifier: {
      kind: 'button',
      // Full-stick driving already reaches the rover's 500-unit limit, so a default turbo button
      // would claim a useful physical control without changing output.
      sources: [],
    },
    slowModifier: {
      kind: 'button',
      sources: [{ kind: 'button', index: 10 }],
    },
    hornHonk: {
      kind: 'button',
      sources: [{ kind: 'button', index: 2 }],
    },
    micPtt: {
      kind: 'button',
      sources: [],
    },
    videoFilterCycle: {
      kind: 'button',
      sources: [],
    },
    chatFocus: {
      kind: 'button',
      sources: [],
    },
    songNoteUp: {
      kind: 'button',
      sources: [{ kind: 'button', index: 12 }],
    },
    songNoteDown: {
      kind: 'button',
      sources: [{ kind: 'button', index: 13 }],
    },
    homeAssistantOn: {
      kind: 'button',
      sources: [{ kind: 'button', index: 15 }],
    },
    homeAssistantOff: {
      kind: 'button',
      sources: [{ kind: 'button', index: 14 }],
    },
    /* These direct digital aux actions mirror the keyboard contract exactly. They start empty
       because the analog trigger/stick defaults above are friendlier on a controller, but users
       can bind either style without the shared control system knowing which device produced it. */
    auxMainForward: { kind: 'button', sources: [] },
    auxMainReverse: { kind: 'button', sources: [] },
    auxSideForward: { kind: 'button', sources: [] },
    auxSideReverse: { kind: 'button', sources: [] },
    auxVacuumFast: { kind: 'button', sources: [] },
    auxVacuumSlow: { kind: 'button', sources: [] },
    auxAllForward: { kind: 'button', sources: [] },
  },
};

export const GAMEPAD_SETTINGS_DEFAULTS = {
  // Runtime instance selection includes the browser slot so two identical controllers remain
  // distinguishable, while profiles below stay keyed by reusable hardware signature.
  activeInstanceKey: null,
  profiles: {},
  defaults: {
    profile: GAMEPAD_PROFILE_DEFAULT,
  },
};

export const HORN_SETTINGS_DEFAULTS = {
  waveform: 'saw',
  freqs: [440, 550, 660, 0],
};

export const AUDIO_SETTINGS_DEFAULTS = {
  masterVolume: 1,
  alertVolume: 0.5,
  roverVolume: 1,
  mainBrushDuckEnabled: true,
  mainBrushDuckAmount: 0.75,
};

export const VIDEO_SETTINGS_DEFAULTS = {
  // Keep the default as unfiltered color because most rovers still provide useful color
  // information. The filter is an operator preference, so it belongs in persisted UI
  // settings instead of being inferred from a rover stream or camera URL.
  colorFilter: 'none',
};
