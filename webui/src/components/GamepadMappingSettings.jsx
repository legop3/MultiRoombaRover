import { useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { GAMEPAD_MAPPING_DEFAULT } from '../settings/namespaces.js';

function useGamepad() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function updateStatus() {
      const pads = navigator.getGamepads?.();
      setConnected(Boolean(pads && Array.from(pads).some(Boolean)));
    }
    updateStatus();
    window.addEventListener('gamepadconnected', updateStatus);
    window.addEventListener('gamepaddisconnected', updateStatus);
    const id = setInterval(updateStatus, 2000);
    return () => {
      window.removeEventListener('gamepadconnected', updateStatus);
      window.removeEventListener('gamepaddisconnected', updateStatus);
      clearInterval(id);
    };
  }, []);

  return connected;
}

const ACTIONS = [
  { id: 'driveHorizontal', label: 'Drive horizontal', type: 'axis', section: 'Drive joystick', path: ['drive', 'horizontal'] },
  { id: 'driveVertical', label: 'Drive vertical', type: 'axis', section: 'Drive joystick', path: ['drive', 'vertical'] },
  { id: 'cameraVertical', label: 'Camera vertical', type: 'axis', section: 'Camera joystick', path: ['camera', 'vertical'] },
  { id: 'mainAxis', label: 'Main brush axis', type: 'axis', section: 'Brush analog', path: ['brushes', 'mainAxis'] },
  { id: 'sideAxis', label: 'Side brush axis', type: 'axis', section: 'Brush analog', path: ['brushes', 'sideAxis'] },
  { id: 'mainReverse', label: 'Toggle main reverse', type: 'button', section: 'Brush toggles', path: ['buttons', 'mainReverse'] },
  { id: 'sideReverse', label: 'Toggle side reverse', type: 'button', section: 'Brush toggles', path: ['buttons', 'sideReverse'] },
  { id: 'vacuum', label: 'Vacuum button', type: 'button', section: 'Auxiliary buttons', path: ['buttons', 'vacuum'] },
  { id: 'allAux', label: 'All aux button', type: 'button', section: 'Auxiliary buttons', path: ['buttons', 'allAux'] },
  { id: 'drive', label: 'Drive macro button', type: 'button', section: 'Mode buttons', path: ['buttons', 'drive'] },
  { id: 'dock', label: 'Dock macro button', type: 'button', section: 'Mode buttons', path: ['buttons', 'dock'] },
];

function formatAxis(value) {
  if (!value) return 'Unassigned';
  return `Axis ${value.index}${value.invert ? ' (invert)' : ''}`;
}

function formatButton(value) {
  if (!value) return 'Unassigned';
  return `Button ${value.index}`;
}

function updatePath(mapping, path, updater) {
  const [group, key] = path;
  const next = { ...(mapping ?? GAMEPAD_MAPPING_DEFAULT) };
  next[group] = { ...(next[group] ?? GAMEPAD_MAPPING_DEFAULT[group]) };
  next[group][key] = updater(next[group][key]);
  return next;
}

export default function GamepadMappingSettings() {
  const gamepadConnected = useGamepad();
  const { value: mapping, save, reset } = useSettingsNamespace('gamepadMapping', GAMEPAD_MAPPING_DEFAULT);
  const [capture, setCapture] = useState(null);

  useEffect(() => {
    if (!capture) return undefined;
    let raf;
    const scan = () => {
      const pads = navigator.getGamepads?.();
      const pad = pads && Array.from(pads).find(Boolean);
      if (pad) {
        if (capture.type === 'axis') {
          for (let i = 0; i < pad.axes.length; i += 1) {
            const value = pad.axes[i];
            if (Math.abs(value) > 0.65) {
              save((prev) =>
                updatePath(prev, capture.path, () => ({
                  index: i,
                  invert: value < 0,
                })),
              );
              setCapture(null);
              return;
            }
          }
        } else if (capture.type === 'button') {
          for (let i = 0; i < pad.buttons.length; i += 1) {
            const btn = pad.buttons[i];
            if (btn && (btn.pressed || btn.value > 0.6)) {
              save((prev) => updatePath(prev, capture.path, () => ({ index: i })));
              setCapture(null);
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(scan);
    };
    raf = requestAnimationFrame(scan);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [capture, save]);

  const grouped = useMemo(() => {
    return ACTIONS.reduce((acc, action) => {
      const list = acc[action.section] || (acc[action.section] = []);
      list.push(action);
      return acc;
    }, {});
  }, []);

  const getValueLabel = (action) => {
    const [group, key] = action.path;
    const stored = mapping?.[group]?.[key] ?? null;
    return action.type === 'axis' ? formatAxis(stored) : formatButton(stored);
  };

  const handleClear = (action) => {
    save((prev) => updatePath(prev, action.path, () => null));
  };

  return (
    <section className="rounded-sm bg-[#1d232b] p-1 text-sm text-slate-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Gamepad mapping</p>
          <p className="text-[0.65rem] text-slate-500">
            {gamepadConnected
              ? 'Move sticks/axes with a big sweep or press buttons when capturing.'
              : 'Connect a controller to configure.'}
          </p>
          {capture && (
            <p className="mt-1 text-[0.7rem] text-emerald-400">Capturing {capture.label}…</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-sm bg-black/40 px-2 py-1 text-xs uppercase tracking-wide text-slate-200 hover:bg-black/60"
        >
          Clear all
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {Object.entries(grouped).map(([section, actions]) => (
          <div key={section} className="rounded border border-white/5 p-1">
            <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">{section}</p>
            <div className="mt-1 space-y-1">
              {actions.map((action) => (
                <div key={action.id} className="flex items-center justify-between rounded bg-black/30 px-1 py-1 text-xs">
                  <div>
                    <p className="font-semibold text-slate-100">{action.label}</p>
                    <p className="text-[0.65rem] text-slate-400">{getValueLabel(action)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleClear(action)}
                      className="rounded bg-slate-800 px-2 py-1 text-[0.65rem] uppercase tracking-wide"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setCapture(action)}
                      className={`rounded px-2 py-1 text-[0.65rem] uppercase tracking-wide ${capture?.id === action.id ? 'bg-emerald-500 text-emerald-950' : 'bg-slate-700 text-slate-100'}`}
                    >
                      {capture?.id === action.id ? 'Waiting…' : 'Capture'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
