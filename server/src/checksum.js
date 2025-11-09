export function checksum8(buffer, length = buffer.length) {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum = (sum + buffer[i]) & 0xff;
  }
  return sum;
}
