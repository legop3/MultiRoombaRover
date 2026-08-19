// Mobile Aux Button
// Purpose: Defines the Mobile Aux Button module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { triggerTouchHaptic } from '../../lib/touchHaptics.js';

export default function MobileAuxButton({ id, label, icon: Icon, values, color, disabled, onPress, onRelease }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        onPress(id, values);
      }}
      onPointerUp={() => {
        onRelease(id);
        // A completed held action is the semantic confirmation point. Keeping
        // feedback beside release avoids buzzing for cancelled aux gestures.
        triggerTouchHaptic('button');
      }}
      onPointerLeave={() => onRelease(id)}
      onPointerCancel={() => onRelease(id)}
      onContextMenu={(event) => event.preventDefault()}
      // The mobile-touch-control class is applied directly to this button because
      // long-press callouts and text selection are triggered at the pressed node.
      className={`mobile-touch-control flex h-full w-full items-center justify-center gap-1 rounded-xl border-2 px-1 py-0.75 text-center text-sm font-semibold text-white transition select-none no-touch-select ${color} hover:brightness-110 active:brightness-125 active:scale-[0.99] disabled:opacity-30`}
    >
      {/* The icon is optional because this low-level held-action control is also
          useful for labels that do not have a clear visual symbol. */}
      {Icon ? <Icon className="shrink-0 text-base" aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}
