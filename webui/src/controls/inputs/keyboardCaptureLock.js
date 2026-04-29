// Keyboard Capture Lock Helper
// Purpose: Coordinates global keyboard-capture lock state across UI regions. Scope: Ensures only intended surfaces receive keyboard control events at runtime.
let keyboardCaptureLocked = false;

export function setKeyboardCaptureLocked(value) {
  keyboardCaptureLocked = Boolean(value);
}

export function isKeyboardCaptureLocked() {
  return keyboardCaptureLocked;
}
