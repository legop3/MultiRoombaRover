// VIP audio upload/mic forwarding constants.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const TARGET_SAMPLE_RATE = 16000;
export const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};
