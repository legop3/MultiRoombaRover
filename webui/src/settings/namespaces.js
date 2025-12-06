export const INPUT_SETTINGS_DEFAULTS = {
  keyboard: {
    baseSpeed: 250,
    turboSpeed: 400,
    precisionSpeed: 125,
  },
  gamepad: {
    driveDeadzone: 0.2,
    cameraDeadzone: 0.25,
    servoStep: 2,
    auxReverseScale: 0.55,
  },
};

export const GAMEPAD_MAPPING_DEFAULT = {
  drive: {
    horizontal: null,
    vertical: null,
  },
  camera: {
    vertical: null,
  },
  brushes: {
    mainAxis: null,
    sideAxis: null,
  },
  buttons: {
    allAux: null,
    vacuum: null,
    mainReverse: null,
    sideReverse: null,
    dock: null,
    drive: null,
  },
};
