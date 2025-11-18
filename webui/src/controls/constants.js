export const AUX_LIMITS = {
  main: [-127, 127],
  side: [-127, 127],
  vacuum: [0, 127],
};

export const DRIVE_LIMITS = {
  maxSpeed: 500,
  baseSpeed: 250,
  boostSpeed: 400,
};

export const COMMAND_DELAY_MS = 200;

export const OI_COMMANDS = {
  start: [128],
  safe: [131],
  full: [132],
  passive: [128],
  dock: [143],
};

export const DEFAULT_KEYMAP = {
  driveForward: ['w'],
  driveBackward: ['s'],
  driveLeft: ['a'],
  driveRight: ['d'],
  boostModifier: ['\\\\'],
  slowModifier: ['shift'],
  auxMainForward: ['o'],
  auxMainReverse: ['l'],
  auxSideForward: ['p'],
  auxSideReverse: [';'],
  auxVacuumFast: ['['],
  auxVacuumSlow: ["'"],
  auxAllForward: ['.'],
  cameraUp: ['i'],
  cameraDown: ['k'],
  driveMacro: ['g'],
  dockMacro: ['h'],
};

export const DEFAULT_MACROS = [
  {
    id: 'drive-sequence',
    label: 'Drive',
    description: 'Start, dock, and full command sequence used by the drive button.',
    steps: [
      { type: 'oi', command: 'start' },
      { type: 'pause', duration: COMMAND_DELAY_MS },
      { type: 'oi', command: 'dock' },
      { type: 'pause', duration: COMMAND_DELAY_MS },
      { type: 'oi', command: 'full' },
    ],
  },
  {
    id: 'seek-dock',
    label: 'Dock',
    description: 'Send the seek dock command.',
    steps: [{ type: 'oi', command: 'dock' }],
  },
];

export const CONTROL_SETTINGS_COOKIE = 'roverControlSettings';
export const CONTROL_SETTINGS_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
