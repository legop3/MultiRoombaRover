// Base64 and auth helpers for upload and WHIP requests.
export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function encodeBase64(value) {
  if (typeof btoa === 'function') return btoa(value);
  return '';
}

export function buildAuthHeader(token) {
  if (!token) return {};
  const encoded = encodeBase64(`${token}:${token}`);
  return encoded ? { Authorization: `Basic ${encoded}` } : {};
}
