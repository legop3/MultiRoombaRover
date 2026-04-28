// Gamepad mapping helper and capture functions.
import { CAPTURE_AXIS_THRESHOLD, CAPTURE_BUTTON_THRESHOLD, NUMBER_FORMAT } from './constants.js';

export function formatSource(source) {
  if (!source) return 'Unassigned';
  if (source.kind === 'axisPair') {
    const invert = `${source.invertX ? 'X inv ' : ''}${source.invertY ? 'Y inv' : ''}`.trim();
    return `Axes ${source.x}/${source.y}${invert ? ` (${invert})` : ''}`;
  }
  if (source.kind === 'axis') {
    return `Axis ${source.index}${source.invert ? ' (inv)' : ''}`;
  }
  if (source.kind === 'button') {
    return `Button ${source.index}`;
  }
  if (source.kind === 'buttonAxis') {
    return `Button ${source.index} (analog)`;
  }
  if (source.kind === 'axisButton') {
    const dir = source.direction < 0 ? '<' : '>';
    return `Axis ${source.index} ${dir} ${NUMBER_FORMAT.format(source.threshold ?? 0.6)}`;
  }
  return 'Unassigned';
}

export function groupActions(actions) {
  return actions.reduce((acc, action) => {
    const list = acc[action.section] || (acc[action.section] = []);
    list.push(action);
    return acc;
  }, {});
}

export function pickActivePad(pads, activeSignature) {
  if (!pads || pads.length === 0) return null;
  if (activeSignature) {
    const match = pads.find((pad) => pad.signature === activeSignature);
    if (match) return match;
  }
  return pads[0];
}

export function snapshotBaseline(pad) {
  return {
    axes: Array.from(pad.axes ?? []),
    buttons: (pad.buttons ?? []).map((btn) => ({
      pressed: Boolean(btn?.pressed),
      value: typeof btn?.value === 'number' ? btn.value : btn?.pressed ? 1 : 0,
    })),
  };
}

function detectAxisCapture(pad, baseline, action) {
  const deltas = (pad.axes ?? []).map((value, index) => ({
    index,
    delta: Math.abs((value ?? 0) - (baseline.axes?.[index] ?? 0)),
    value,
  }));
  deltas.sort((a, b) => b.delta - a.delta);
  if (action.kind === 'axisPair') {
    const top = deltas.filter((entry) => entry.delta > CAPTURE_AXIS_THRESHOLD).slice(0, 2);
    if (top.length < 2) return null;
    return {
      kind: 'axisPair',
      x: top[0].index,
      y: top[1].index,
      ...(action.invertDefaults ?? {}),
    };
  }
  const match = deltas.find((entry) => entry.delta > CAPTURE_AXIS_THRESHOLD);
  if (!match) return null;
  return {
    kind: 'axis',
    index: match.index,
    ...(action.invertDefaults ?? {}),
  };
}

function detectButtonCapture(pad, baseline, action) {
  const buttons = pad.buttons ?? [];
  for (let i = 0; i < buttons.length; i += 1) {
    const btn = buttons[i];
    const value = typeof btn?.value === 'number' ? btn.value : btn?.pressed ? 1 : 0;
    if (btn?.pressed || value > CAPTURE_BUTTON_THRESHOLD) {
      if (action.kind === 'axis') {
        return { kind: 'buttonAxis', index: i };
      }
      return { kind: 'button', index: i };
    }
  }
  const axes = pad.axes ?? [];
  for (let i = 0; i < axes.length; i += 1) {
    const value = axes[i] ?? 0;
    const delta = Math.abs(value - (baseline.axes?.[i] ?? 0));
    if (Math.abs(value) > 0.7 && delta > 0.5) {
      if (action.kind === 'axis') {
        return { kind: 'axis', index: i, ...(action.invertDefaults ?? {}) };
      }
      return { kind: 'axisButton', index: i, direction: value >= 0 ? 1 : -1, threshold: 0.6 };
    }
  }
  return null;
}

export function buildDescriptorFromCapture(pad, baseline, action) {
  if (!pad) return null;
  if (action.kind === 'axis' || action.kind === 'axisPair') {
    const axisDescriptor = detectAxisCapture(pad, baseline, action);
    if (axisDescriptor) return axisDescriptor;
  }
  return detectButtonCapture(pad, baseline, action);
}
