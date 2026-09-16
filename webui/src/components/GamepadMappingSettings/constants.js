// constants
// Purpose: Defines the constants module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const ACTIONS = [
  {
    id: 'drive',
    label: 'Drive stick',
    kind: 'axisPair',
    section: 'Driving',
    invertDefaults: { invertX: false, invertY: true },
    driveMode: 'single',
  },
  {
    id: 'tankLeft',
    label: 'Left track',
    kind: 'axis',
    section: 'Driving',
    invertDefaults: { invert: true },
    driveMode: 'tank',
  },
  {
    id: 'tankRight',
    label: 'Right track',
    kind: 'axis',
    section: 'Driving',
    invertDefaults: { invert: true },
    driveMode: 'tank',
  },
  {
    id: 'cameraTilt',
    label: 'Camera tilt',
    kind: 'axis',
    section: 'Camera',
    invertDefaults: { invert: true },
    driveMode: 'single',
  },
  { id: 'tankCameraUp', label: 'Camera up', kind: 'button', section: 'Camera', driveMode: 'tank' },
  { id: 'tankCameraDown', label: 'Camera down', kind: 'button', section: 'Camera', driveMode: 'tank' },
  {
    id: 'mainBrush',
    label: 'Main brush',
    kind: 'axis',
    section: 'Brushes',
    invertDefaults: { invert: false },
  },
  {
    id: 'sideBrush',
    label: 'Side brush',
    kind: 'axis',
    section: 'Brushes',
    invertDefaults: { invert: false },
  },
  { id: 'vacuum', label: 'Vacuum only', kind: 'button', section: 'Aux buttons' },
  { id: 'allAux', label: 'All cleaning motors', kind: 'button', section: 'Aux buttons' },
  { id: 'mainReverse', label: 'Main reverse toggle', kind: 'button', section: 'Brush toggles' },
  { id: 'sideReverse', label: 'Side reverse toggle', kind: 'button', section: 'Brush toggles' },
  { id: 'driveMacro', label: 'Drive / undock sequence', kind: 'button', section: 'Mode controls' },
  { id: 'dockMacro', label: 'Manual docking assist', kind: 'button', section: 'Mode controls' },
  { id: 'headlightToggle', label: 'Headlight toggle', kind: 'button', section: 'Camera' },
  { id: 'laserToggle', label: 'Laser toggle', kind: 'button', section: 'Camera' },
  { id: 'boostModifier', label: 'Turbo modifier', kind: 'button', section: 'Driving' },
  { id: 'slowModifier', label: 'Precision modifier', kind: 'button', section: 'Driving' },
  { id: 'hornHonk', label: 'Horn (hold)', kind: 'button', section: 'Audio and chat' },
  { id: 'micPtt', label: 'Microphone push to talk', kind: 'button', section: 'Audio and chat' },
  { id: 'chatFocus', label: 'Focus chat', kind: 'button', section: 'Audio and chat' },
  { id: 'videoFilterCycle', label: 'Cycle video filter', kind: 'button', section: 'Camera' },
  { id: 'songNoteUp', label: 'Play higher note', kind: 'button', section: 'Audio and chat', driveMode: 'single' },
  { id: 'songNoteDown', label: 'Play lower note', kind: 'button', section: 'Audio and chat', driveMode: 'single' },
  { id: 'homeAssistantOn', label: 'Turn next room light on', kind: 'button', section: 'Room lights' },
  { id: 'homeAssistantOff', label: 'Turn next room light off', kind: 'button', section: 'Room lights' },
  /* Digital aux actions provide exact parity with the keyboard help surface. They coexist with
     analog brush controls so each operator can choose proportional triggers or discrete buttons. */
  { id: 'auxMainForward', label: 'Main brush forward', kind: 'button', section: 'Aux buttons' },
  { id: 'auxMainReverse', label: 'Main brush reverse', kind: 'button', section: 'Aux buttons' },
  { id: 'auxSideForward', label: 'Side brush forward', kind: 'button', section: 'Aux buttons' },
  { id: 'auxSideReverse', label: 'Side brush reverse', kind: 'button', section: 'Aux buttons' },
  { id: 'auxVacuumFast', label: 'Vacuum max', kind: 'button', section: 'Aux buttons' },
  { id: 'auxVacuumSlow', label: 'Vacuum low', kind: 'button', section: 'Aux buttons' },
  { id: 'auxAllForward', label: 'All motors forward', kind: 'button', section: 'Aux buttons' },
];

export const CAPTURE_AXIS_THRESHOLD = 0.45;
export const CAPTURE_BUTTON_THRESHOLD = 0.6;
