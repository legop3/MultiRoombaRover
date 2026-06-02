// Help Panel
// Purpose: Defines the Help Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useControlSystem } from '../../controls/index.js';
import CardFrame from '../CardFrame/index.jsx';
import HelpContentView from '../HelpContentView/index.jsx';

export default function HelpPanel({ layout, onOpenOverlay }) {
  const { state } = useControlSystem();

  const actions = (
    <button
      type="button"
      onClick={onOpenOverlay}
      className="button-dark px-1 py-0.25 text-[0.75rem]"
    >
      Open full help
    </button>
  );

  return (
    <CardFrame title="Help" actions={actions} bodyClassName="space-y-0.5 text-sm">
      <HelpContentView layout={layout} keymap={state?.keymap || {}} />
    </CardFrame>
  );
}
