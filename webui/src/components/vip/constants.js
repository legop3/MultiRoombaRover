export const COOKIE_KEY_REGEX = /^cu_[a-f0-9]{32}$/;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const fieldClass = 'field-input w-full max-w-sm text-left focus:ring-emerald-500';
export const flowWrapClass = 'mx-auto w-full max-w-xl flex justify-center';
export const innerFlowClass = 'mx-auto flex w-full max-w-md flex-col items-center space-y-0.5 text-center';

export function maskKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
