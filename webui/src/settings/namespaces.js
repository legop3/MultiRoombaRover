export const INPUT_SETTINGS_DEFAULTS = {
  keyboard: {
    baseSpeed: 250,
    turboSpeed: 400,
    precisionSpeed: 125,
    tiltSpeed: 80,
    tiltIntervalMs: 110,
  },
};

export const GAMEPAD_PROFILE_DEFAULT = {
  label: 'Default',
  calibration: {
    driveDeadzone: 0.18,
    cameraDeadzone: 0.08,
    auxDeadzone: 0.05,
    driveCurve: 'linear',
    cameraCurve: 'linear',
    auxCurve: 'linear',
    cameraMode: 'absolute',
    cameraSensitivity: 60,
    auxSideScale: 0.55,
  },
  bindings: {
    drive: {
      kind: 'axisPair',
      sources: [{ kind: 'axisPair', x: 0, y: 1, invertX: false, invertY: true }],
    },
    cameraTilt: {
      kind: 'axis',
      sources: [
        { kind: 'axis', index: 3, invert: true },
        { kind: 'axis', index: 1, invert: true },
      ],
    },
    mainBrush: {
      kind: 'axis',
      sources: [
        { kind: 'buttonAxis', index: 6 },
        { kind: 'axis', index: 2, invert: false },
      ],
    },
    sideBrush: {
      kind: 'axis',
      sources: [
        { kind: 'buttonAxis', index: 7 },
        { kind: 'axis', index: 5, invert: false },
      ],
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
    nightVisionToggle: {
      kind: 'button',
      sources: [{ kind: 'button', index: 9 }],
    },
  },
};

export const GAMEPAD_SETTINGS_DEFAULTS = {
  activeSignature: null,
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
  autoLevelEnabled: true,
  autoLevelMode: 'compressor',
};
