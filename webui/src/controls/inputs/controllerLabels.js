// Controller Prompt Labels
// Purpose: Converts persisted controller bindings into compact prompts for the connected hardware.
// Scope: Delegates hardware identification and standard button naming to gamepad-helper while
// keeping rover action aliases and compact presentation local to the controller input layer.
import GamepadHelper from '@lizardbyte/gamepad-helper/src/js/gamepad-helper.js';

const gamepadHelper = new GamepadHelper();

const ACTION_ALIASES = {
  driveForward: { bindingId: 'drive', direction: 'up' },
  driveBackward: { bindingId: 'drive', direction: 'down' },
  driveLeft: { bindingId: 'drive', direction: 'left' },
  driveRight: { bindingId: 'drive', direction: 'right' },
  cameraUp: { bindingId: 'cameraTilt', direction: 'up' },
  cameraDown: { bindingId: 'cameraTilt', direction: 'down' },
  auxMainForward: { bindingId: 'mainBrush', direction: 'forward' },
  auxMainReverse: { bindingId: 'mainBrush', direction: 'reverse' },
  auxSideForward: { bindingId: 'sideBrush', direction: 'forward' },
  auxSideReverse: { bindingId: 'sideBrush', direction: 'reverse' },
  auxVacuumFast: { bindingId: 'vacuum' },
  auxVacuumSlow: { bindingId: 'vacuum' },
  auxAllForward: { bindingId: 'allAux' },
};

const DIRECTION_GLYPHS = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  forward: '+',
  reverse: '−',
};

const TANK_DIRECTION_GLYPHS = {
  driveForward: ['up', 'up'],
  driveBackward: ['down', 'down'],
  driveLeft: ['down', 'up'],
  driveRight: ['up', 'down'],
};

const COMPACT_BUTTON_NAMES = {
  DUp: 'D↑',
  DDown: 'D↓',
  DLeft: 'D←',
  DRight: 'D→',
  TouchPad: 'Touchpad',
};

function controllerType(controller, promptStyle) {
  /* Manual prompt selection is a direct library controller type, not a model-name imitation.
     Automatic mode gives the complete browser ID to gamepad-helper unchanged; in particular,
     its vendor/product lookup directly recognizes Linux's 054c-0ce6 DualSense identifier. */
  if (promptStyle && promptStyle !== 'auto') return promptStyle;
  return gamepadHelper.detectControllerType(controller?.id ?? '');
}

export function describeController(controller) {
  const info = gamepadHelper.getGamepadInfo(controller?.id ?? '');
  return {
    model: info.type,
    brand: info.type === gamepadHelper.CONTROLLER_TYPES.PLAYSTATION ? 'Sony' : null,
    description: info.name,
  };
}

function compactButtonName(source, type) {
  const name = gamepadHelper.getButtonName(type, source.index);
  return COMPACT_BUTTON_NAMES[name] ?? name;
}

function compactAxisName(source) {
  /* Standard browser mappings place sticks in adjacent pairs. Showing the stick instead of its
     raw component keeps prompts short; the action and optional arrow already convey the axis. */
  if (source.index === 0 || source.index === 1) return 'LS';
  if (source.index === 2 || source.index === 3) return 'RS';
  return `A${source.index}`;
}

function compactAxisPairName(source) {
  if (source.x === 0 && source.y === 1) return 'LS';
  if (source.x === 2 && source.y === 3) return 'RS';
  return `A${source.x}/${source.y}`;
}

function compactSourceName(source, type) {
  if (!source) return '—';
  if (source.kind === 'chord') {
    return (source.inputs ?? []).map((input) => compactSourceName(input, type)).join('+');
  }
  if (source.kind === 'axisPair') return compactAxisPairName(source);
  if (source.kind === 'button' || source.kind === 'buttonAxis') {
    return compactButtonName(source, type);
  }
  if (source.kind === 'axis' || source.kind === 'axisButton') {
    return compactAxisName(source);
  }
  return '—';
}

export function bindingForControllerAction(profile, actionId) {
  const direct = profile?.bindings?.[actionId];
  if (direct?.sources?.length) return { binding: direct, direction: null };
  if (profile?.calibration?.driveMode === 'tank' && actionId === 'cameraUp') {
    return { binding: profile?.bindings?.tankCameraUp ?? null, direction: null };
  }
  if (profile?.calibration?.driveMode === 'tank' && actionId === 'cameraDown') {
    return { binding: profile?.bindings?.tankCameraDown ?? null, direction: null };
  }
  const alias = ACTION_ALIASES[actionId];
  if (!alias) return { binding: direct ?? null, direction: null };
  return {
    binding: profile?.bindings?.[alias.bindingId] ?? null,
    direction: alias.direction ?? null,
  };
}

export function formatControllerBinding(profile, actionId, controller) {
  if (profile?.calibration?.driveMode === 'tank' && TANK_DIRECTION_GLYPHS[actionId]) {
    const leftSource = profile?.bindings?.tankLeft?.sources?.[0];
    const rightSource = profile?.bindings?.tankRight?.sources?.[0];
    if (!leftSource || !rightSource) return '—';
    const type = controllerType(controller, profile?.promptStyle);
    const [leftDirection, rightDirection] = TANK_DIRECTION_GLYPHS[actionId];
    /* A tank movement is inherently a two-input gesture. Showing both compact stick directions
       makes help labels accurate without spelling out controller model names or raw axis numbers. */
    return `${compactSourceName(leftSource, type)} ${DIRECTION_GLYPHS[leftDirection]} + ${compactSourceName(rightSource, type)} ${DIRECTION_GLYPHS[rightDirection]}`;
  }
  const { binding, direction } = bindingForControllerAction(profile, actionId);
  const source = binding?.sources?.[0];
  if (!source) return '—';
  const type = controllerType(controller, profile?.promptStyle);
  const label = compactSourceName(source, type);
  const directionLabel = direction ? DIRECTION_GLYPHS[direction] : null;
  return directionLabel ? `${label} ${directionLabel}` : label;
}
