import { useControlSystem } from '../controls/index.js';
import HelpContentView from './HelpContentView.jsx';

export default function HelpOverlay({ visible, layout, onClose, showOnLoad, onToggleShowOnLoad }) {
  if (!visible) return null;

  const { state } = useControlSystem();

  const handleCheckbox = (event) => {
    const keepShowing = !event.target.checked;
    onToggleShowOnLoad?.(keepShowing);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 px-0.5 py-0.5">
      <div className="pointer-events-auto surface w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-0.5 py-0.25 text-sm text-slate-200">
          <span className="font-semibold">Help & controls</span>
          <div className="flex items-center gap-0.5 text-[0.8rem] text-slate-300">
            <label className="flex items-center gap-0.25">
              <input
                type="checkbox"
                checked={!showOnLoad}
                onChange={handleCheckbox}
                className="accent-cyan-500"
              />
              <span>Don&apos;t show again</span>
            </label>
            <button
              type="button"
              onClick={onClose}
              className="button-dark px-2 py-0.25 text-[0.8rem]"
            >
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[85vh] overflow-y-auto p-0.5">
          <HelpContentView layout={layout} keymap={state?.keymap || {}} />
        </div>
      </div>
    </div>
  );
}
