// Input Focus Utilities
// Purpose: Handles focus/blur guards so controls only capture input when appropriate. Scope: Prevents accidental command capture while typing or using form elements.
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'password',
  'url',
  'tel',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

export function isTextInputElement(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = target.type ? target.type.toLowerCase() : '';
  return TEXT_INPUT_TYPES.has(type);
}

export function isTextEntryActive() {
  if (typeof document === 'undefined') return false;
  return isTextInputElement(document.activeElement);
}
