// constants
// Purpose: Defines the constants module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export const COOKIE_KEY_REGEX = /^cu_[a-f0-9]{32}$/;

export const fieldClass = 'field-input w-full max-w-sm text-left focus:ring-emerald-500';
export const flowWrapClass = 'mx-auto w-full max-w-xl flex justify-center';
export const innerFlowClass = 'mx-auto flex w-full max-w-md flex-col items-center space-y-0.5 text-center';

export function maskKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}
