// Touch Haptics
// Purpose: Adds lightweight physical confirmation to the WebUI's mobile control surfaces.
// Scope: Maps semantic control actions to the shared web-haptics compatibility layer.
import { WebHaptics } from 'web-haptics';

/*
  Use explicit patterns instead of the library's very short selection preset.
  Apart from being easier to feel on Android, the descending durations give
  Safari's switch-based fallback room to express a button as several ticks, a
  drive boundary as fewer ticks, and a camera step as one light tick.
*/
export const TOUCH_HAPTIC_PATTERNS = Object.freeze({
  button: [{ duration: 50, intensity: 1 }],
  drive: [{ duration: 30, intensity: 1 }],
  camera: [{ duration: 15, intensity: 1 }],
});

/*
  Keep one vanilla instance for the application lifetime. The controls do not
  need framework-specific hooks, and a singleton lets the library cancel or
  replace an in-progress pattern consistently when the driver moves quickly.
  Browser-specific vibration and Safari fallback behavior deliberately belongs
  to web-haptics so future dependency upgrades improve every control together.
*/
const touchHaptics = new WebHaptics();

export function triggerTouchHaptic(kind = 'button') {
  /*
    Controls request feedback by meaning rather than forwarding DOM events.
    This keeps disabled/no-op decisions beside the command that owns them and
    leaves browser capability handling entirely inside web-haptics.
  */
  const pattern = TOUCH_HAPTIC_PATTERNS[kind] || TOUCH_HAPTIC_PATTERNS.button;

  /*
    The promise describes completion of any scheduled pattern; control input
    must never wait for physical feedback, so intentionally leave it detached
    from the rover command path.
  */
  void touchHaptics.trigger(pattern);
  return true;
}
