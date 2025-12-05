import { useControlSystem } from '../controls/index.js';
import HelpContentView from './HelpContentView.jsx';

export default function HelpPanel({ layout, onOpenOverlay }) {
  const { state } = useControlSystem();

  return (
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Help</span>
        <button
          type="button"
          onClick={onOpenOverlay}
          className="button-dark px-1 py-0.25 text-[0.75rem]"
        >
          Open full help
        </button>
      </div>
      <HelpContentView layout={layout} keymap={state?.keymap || {}} />
    </section>
  );
}
