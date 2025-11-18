export const INPUT_SETTINGS_DEFAULTS = {
  gamepad: {
    driveDeadzone: 0.2,
    cameraDeadzone: 0.25,
    servoStep: 2,
    auxReverseScale: 0.55,
  },
  mobile: {
    joystickRadius: 80,
    joystickSmoothing: 0.15,
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
  triggers: {
    main: null,
    side: null,
  },
  buttons: {
    mainReverse: null,
    sideReverse: null,
    vacuum: null,
    allAux: null,
    driveMacro: null,
    dockMacro: null,
  },
};
