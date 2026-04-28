// Gamepad mapping constants and action catalog.
export const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const ACTIONS = [
  {
    id: 'drive',
    label: 'Drive stick',
    kind: 'axisPair',
    section: 'Driving',
    invertDefaults: { invertX: false, invertY: true },
  },
  {
    id: 'cameraTilt',
    label: 'Camera tilt',
    kind: 'axis',
    section: 'Camera',
    invertDefaults: { invert: true },
  },
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
  { id: 'vacuum', label: 'Vacuum', kind: 'button', section: 'Aux buttons' },
  { id: 'allAux', label: 'All aux', kind: 'button', section: 'Aux buttons' },
  { id: 'mainReverse', label: 'Main reverse toggle', kind: 'button', section: 'Brush toggles' },
  { id: 'sideReverse', label: 'Side reverse toggle', kind: 'button', section: 'Brush toggles' },
  { id: 'driveMacro', label: 'Drive macro', kind: 'button', section: 'Mode macros' },
  { id: 'dockMacro', label: 'Dock macro', kind: 'button', section: 'Mode macros' },
  { id: 'nightVisionToggle', label: 'Night vision toggle', kind: 'button', section: 'Camera' },
];

export const CAPTURE_AXIS_THRESHOLD = 0.45;
export const CAPTURE_BUTTON_THRESHOLD = 0.6;
