/* global Buffer */

function encodeBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

export function buildAuthHeader(token) {
  if (!token) return {};
  const credential = `${token}:${token}`;
  const encoded = encodeBase64(credential);
  return { Authorization: `Basic ${encoded}` };
}
