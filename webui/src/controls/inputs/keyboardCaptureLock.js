let keyboardCaptureLocked = false;

export function setKeyboardCaptureLocked(value) {
  keyboardCaptureLocked = Boolean(value);
}

export function isKeyboardCaptureLocked() {
  return keyboardCaptureLocked;
}
