import { useMemo, useState, useEffect, useCallback } from 'react';
import { useControlSystem } from '../controls/index.js';
import { DEFAULT_KEYMAP } from '../controls/constants.js';
import { canonicalizeKeyInput, formatKeyLabel } from '../controls/keymapUtils.js';

const KEY_ACTIONS = [
  { id: 'driveForward', label: 'Drive Forward', group: 'Driving' },
  { id: 'driveBackward', label: 'Drive Backward', group: 'Driving' },
  { id: 'driveLeft', label: 'Turn Left', group: 'Driving' },
  { id: 'driveRight', label: 'Turn Right', group: 'Driving' },
  { id: 'boostModifier', label: 'Boost Modifier', group: 'Driving' },
  { id: 'slowModifier', label: 'Slow Modifier', group: 'Driving' },
  { id: 'auxMainForward', label: 'Main Brush Forward', group: 'Aux Motors' },
  { id: 'auxMainReverse', label: 'Main Brush Reverse', group: 'Aux Motors' },
  { id: 'auxSideForward', label: 'Side Brush Forward', group: 'Aux Motors' },
  { id: 'auxSideReverse', label: 'Side Brush Reverse', group: 'Aux Motors' },
  { id: 'auxVacuumFast', label: 'Vacuum Max', group: 'Aux Motors' },
  { id: 'auxVacuumSlow', label: 'Vacuum Low', group: 'Aux Motors' },
  { id: 'auxAllForward', label: 'All Aux Forward', group: 'Aux Motors' },
  { id: 'cameraUp', label: 'Camera Up', group: 'Camera' },
  { id: 'cameraDown', label: 'Camera Down', group: 'Camera' },
  { id: 'driveMacro', label: 'Drive Macro', group: 'Macros' },
  { id: 'dockMacro', label: 'Dock Macro', group: 'Macros' },
];

function groupActions(actions) {
  return actions.reduce((acc, action) => {
    const list = acc[action.group] || (acc[action.group] = []);
    list.push(action);
    return acc;
  }, {});
}

function useKeyCapture(onCapture) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    function handle(event) {
      event.preventDefault();
      if (event.key === 'Escape') {
        setActive(null);
        return;
      }
      const canonical = canonicalizeKeyInput(event.key ?? '');
      if (canonical) {
        onCapture(active, canonical, event);
        setActive(null);
      }
    }
    window.addEventListener('keydown', handle, { capture: true });
    return () => window.removeEventListener('keydown', handle, { capture: true });
  }, [active, onCapture]);

  return { active, startCapture: setActive, cancel: () => setActive(null) };
}

export default function KeymapSettings() {
  const {
    state: { keymap },
    actions: { updateKeyBinding, resetKeyBindings },
  } = useControlSystem();
  const grouped = useMemo(() => groupActions(KEY_ACTIONS), []);
  const { active, startCapture, cancel } = useKeyCapture((actionId, value) => {
    updateKeyBinding(actionId, value);
  });

  const currentKey = useCallback(
    (id) => keymap?.[id]?.[0] || DEFAULT_KEYMAP[id]?.[0] || '',
    [keymap],
  );

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Keyboard layout</p>
          <p className="text-[0.7rem] text-slate-500">Per-browser · click to change a binding</p>
        </div>
        <button type="button" onClick={() => resetKeyBindings()} className="button-dark text-xs">
          Reset defaults
        </button>
      </div>
      <div className="space-y-0.5">
        {Object.entries(grouped).map(([group, actions]) => (
          <div key={group} className="space-y-0.5 surface">
            <p className="text-[0.75rem] text-slate-400">{group}</p>
            <div className="space-y-0.5">
              {actions.map((action) => {
                const value = currentKey(action.id);
                const isActive = active === action.id;
                return (
                  <div key={action.id} className="surface-muted flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-slate-100">{action.label}</p>
                      <p className="text-[0.65rem] text-slate-400">{formatKeyLabel(value)}</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {isActive && (
                        <button type="button" onClick={() => cancel()} className="button-danger text-[0.7rem]">
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startCapture(action.id)}
                        className={`${isActive ? 'px-0.5 py-0.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400' : 'button-dark'} text-[0.7rem] font-medium transition-colors`}
                      >
                        {isActive ? 'Press a key…' : 'Change'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
