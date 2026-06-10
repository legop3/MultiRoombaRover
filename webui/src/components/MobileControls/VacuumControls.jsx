// Vacuum Controls
// Purpose: Renders the mobile-only vacuum forward/backward auxiliary motor controls.
// Scope: Owns only the two vacuum buttons; the parent column owns rover state and aux motor commands.
import MobileAuxButton from './MobileAuxButton.jsx';
import { AUX_ALL_BACKWARD, AUX_ALL_FORWARD } from './constants.js';

export default function VacuumControls({
  disabled,
  onPress,
  onRelease,
}) {
  return (
    <div className="mobile-touch-control grid min-h-0 grid-rows-2 gap-0.5">
      <MobileAuxButton
        id="aux-vac-forward"
        label="Vacuum Forward"
        values={AUX_ALL_FORWARD}
        color="bg-fuchsia-600"
        disabled={disabled}
        onPress={onPress}
        onRelease={onRelease}
      />
      <MobileAuxButton
        id="aux-vac-backward"
        label="Vacuum Backward"
        values={AUX_ALL_BACKWARD}
        color="bg-fuchsia-800"
        disabled={disabled}
        onPress={onPress}
        onRelease={onRelease}
      />
    </div>
  );
}
