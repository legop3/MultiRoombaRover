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
  behaviorVersion: 2,
  label: 'Default',
  promptStyle: 'auto',
  calibration: {
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
    cameraTilt: {
      kind: 'axis',
      sources: [{ kind: 'axis', index: 3, invert: true }],
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
      sources: [{ kind: 'button', index: 0 }],
    },
    allAux: {
      kind: 'button',
      sources: [{ kind: 'button', index: 1 }],
    },
    mainReverse: {
      kind: 'button',
      sources: [{ kind: 'button', index: 4 }],
    },
    sideReverse: {
      kind: 'button',
      sources: [{ kind: 'button', index: 5 }],
    },
    driveMacro: {
      kind: 'button',
      sources: [{ kind: 'button', index: 2 }],
    },
    dockMacro: {
      kind: 'button',
      sources: [{ kind: 'button', index: 3 }],
    },
    headlightToggle: {
      kind: 'button',
      sources: [{ kind: 'button', index: 9 }],
    },
    laserToggle: {
      kind: 'button',
      sources: [],
    },
    boostModifier: {
      kind: 'button',
      sources: [{ kind: 'button', index: 10 }],
    },
    slowModifier: {
      kind: 'button',
      sources: [{ kind: 'button', index: 11 }],
    },
    hornHonk: {
      kind: 'button',
      sources: [{ kind: 'button', index: 12 }],
    },
    micPtt: {
      kind: 'button',
      sources: [{ kind: 'button', index: 13 }],
    },
    videoFilterCycle: {
      kind: 'button',
      sources: [{ kind: 'button', index: 14 }],
    },
    chatFocus: {
      kind: 'button',
      sources: [{ kind: 'button', index: 15 }],
    },
    songNoteUp: {
      kind: 'button',
      sources: [],
    },
    songNoteDown: {
      kind: 'button',
      sources: [],
    },
    homeAssistantOn: {
      kind: 'button',
      sources: [],
    },
    homeAssistantOff: {
      kind: 'button',
      sources: [],
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
