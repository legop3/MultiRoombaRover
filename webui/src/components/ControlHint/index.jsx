// Adaptive Control Hint
// Purpose: Renders the binding for a logical action using the user's most recently used input type.
// Scope: Keeps the render component separate from its hook so React fast refresh can safely
// replace this module without treating a non-component export as component state.
import { useControlHintLabel } from './useControlHintLabel.js';

export default function ControlHint({ actionId }) {
  return <>{useControlHintLabel(actionId)}</>;
}
