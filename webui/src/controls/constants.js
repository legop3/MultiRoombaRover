// Control System Constants
// Purpose: Defines immutable control tuning and command constants for input pipelines. Scope: Central source of truth for movement scaling, deadzones, and timing values.
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

export const SONG_NOTE_RANGE = [31, 127];
export const SONG_DEFAULT_NOTE = 60;
export const SONG_DEFAULT_DURATION = 8;
export const SONG_REPEAT_MS = 250;

export const HORN_MAX_MS = 4000;
export const HORN_MAX_FREQUENCY = 2000;
export const HORN_HEAT_UP_PER_SEC = 0.4;
export const HORN_HEAT_COOL_PER_SEC = 0.2;
export const HORN_HEAT_RESUME_THRESHOLD = 0.8;

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
  boostModifier: ['\\'],
  slowModifier: ['shift'],
  auxMainForward: ['i'],
  auxMainReverse: ['k'],
  auxSideForward: ['o'],
  auxSideReverse: ['l'],
  auxVacuumFast: ['p'],
  auxVacuumSlow: [';'],
  auxAllForward: [","],
  cameraUp: ['u'],
  cameraDown: ['j'],
  headlightToggle: ['e'],
  laserToggle: ['r'],
  videoFilterCycle: ['2'],
  hornHonk: ['h'],
  micPtt: ['m'],
  driveMacro: ['f'],
  dockMacro: ['g'],
  chatFocus: ['enter'],
  songNoteUp: ['ArrowUp'],
  songNoteDown: ['ArrowDown'],
  homeAssistantOn: ['ArrowRight'],
  homeAssistantOff: ['ArrowLeft'],
};
